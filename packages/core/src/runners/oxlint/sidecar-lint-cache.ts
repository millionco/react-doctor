import * as path from "node:path";
import * as Schema from "effect/Schema";
import type { Diagnostic } from "../../types/index.js";
import {
  FILE_LINT_CACHE_MAX_FILE_COUNT,
  FILE_LINT_CACHE_MAX_RULESET_COUNT,
  SIDECAR_LINT_CACHE_FILENAME,
  SIDECAR_LINT_CACHE_SCHEMA_VERSION,
} from "../../constants.js";
import { CachedDiagnostic } from "./cached-diagnostic.js";
import { atomicWriteJson } from "../../utils/atomic-write-json.js";
import { failOpenReadJson } from "../../utils/fail-open-read-json.js";
import { isRecord } from "../../utils/is-record.js";

/**
 * Sidecar lint cache for the cross-file rules. Sibling of
 * `file-lint-cache.ts` (same location, bucket layout, LRU pruning, and
 * atomic fail-open persistence) with one addition per entry: the file's
 * cross-file dependency PROBE SET, recorded by the plugin's dependency
 * collectors (`oxlint-plugin-react-doctor`, `cross-file-dependencies.ts`)
 * when the entry was stored.
 *
 * The file key pins the file's own content (`<relativePath> <hash>`,
 * identical to the file cache) and the bucket hash pins the sidecar ruleset
 * + toolchain; the probe set pins everything ELSE the cross-file rules read
 * for this file — other files' content hashes and the existence
 * classification of every resolution candidate. `run-oxlint.ts` replays an
 * entry's diagnostics only after re-answering every probe against the
 * current filesystem and matching every answer; any mismatch (or any decode
 * failure — every operation fails open) degrades to a fresh sidecar lint of
 * that file, never to a stale verdict.
 *
 * Probes are INTERNED: a ruleset bucket holds one table of distinct
 * `(kind, path, answer)` records and each file entry references them by
 * index. A large repo records hundreds of probes per file (every
 * module-resolution candidate of every import), almost all shared with its
 * siblings — a 1,000-file scan stored ~500k probe tuples over a few thousand
 * distinct records, a 27 MB JSON file that cost a quarter-second to parse
 * and write. Interning keeps the file small, and lets verification answer
 * each distinct record once per scan instead of once per referencing file.
 * A record is immutable (the answer is part of its identity), so an entry
 * stored against an older answer of the same path keeps pointing at the
 * older record and still mismatches on replay.
 */

/** One recorded filesystem probe: what was consulted, and its answer. */
export interface SidecarDependencyProbe {
  /** `"content"` — the file's bytes were read; `"exists"` — only its existence class. */
  readonly kind: "content" | "exists";
  /** Root-relative (`/`-separated) path; `..`-prefixed when outside the root. */
  readonly path: string;
  /** Content hash / existence class at store time (see `resolve-sidecar-probe-answer.ts`). */
  readonly answer: string;
}

export interface SidecarFileEntry {
  /** Indexes into the cache's probe table (see `internProbe` / `probeAt`). */
  readonly probeIds: ReadonlyArray<number>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

export type SidecarProbeAnswerFor = (
  kind: SidecarDependencyProbe["kind"],
  relativePath: string,
) => string;

export interface SidecarLintCache {
  /** Cached entry for the key, or `null` on a miss. */
  readonly lookup: (fileKey: string) => SidecarFileEntry | null;
  /**
   * Whether every probe of `entry` still has its stored answer. Each distinct
   * probe record is answered at most once per cache instance (the filesystem
   * is frozen for the scan), so verifying many files sharing the same
   * dependencies costs one answer per dependency.
   */
  readonly isReplayable: (entry: SidecarFileEntry, answerFor: SidecarProbeAnswerFor) => boolean;
  /** Returns the id of the `(kind, path, answer)` record, adding it when new. */
  readonly internProbe: (
    kind: SidecarDependencyProbe["kind"],
    relativePath: string,
    answer: string,
  ) => number;
  /** The record behind a probe id. */
  readonly probeAt: (probeId: number) => SidecarDependencyProbe;
  /** Records a freshly-linted file's probe set + cross-file diagnostics. */
  readonly store: (fileKey: string, entry: SidecarFileEntry) => void;
  /** Flushes this run's entries to disk (call once, after the lint pass). */
  readonly persist: () => void;
}

type PersistedProbe = readonly [SidecarDependencyProbe["kind"], string, string];

interface PersistedFileEntry {
  readonly probeIds: ReadonlyArray<number>;
  readonly diagnostics: ReadonlyArray<unknown>;
}

interface PersistedRuleset {
  readonly updatedAtMs: number;
  readonly probes: ReadonlyArray<PersistedProbe>;
  readonly files: Record<string, PersistedFileEntry>;
}

interface PersistedSidecarLintCache {
  readonly version: number;
  readonly rulesets: Record<string, PersistedRuleset>;
}

interface DecodedRuleset {
  readonly probes: ReadonlyArray<SidecarDependencyProbe>;
  readonly files: ReadonlyMap<string, PersistedFileEntry>;
}

interface ProbeTable {
  readonly records: SidecarDependencyProbe[];
  readonly intern: (
    kind: SidecarDependencyProbe["kind"],
    relativePath: string,
    answer: string,
  ) => number;
}

const validateDiagnostic = Schema.decodeUnknownSync(CachedDiagnostic);

const isProbeKind = (value: unknown): value is SidecarDependencyProbe["kind"] =>
  value === "content" || value === "exists";

const isProbeIdArray = (value: unknown, probeCount: number): value is ReadonlyArray<number> =>
  Array.isArray(value) &&
  value.every(
    (probeId) =>
      typeof probeId === "number" &&
      Number.isInteger(probeId) &&
      probeId >= 0 &&
      probeId < probeCount,
  );

const createProbeTable = (): ProbeTable => {
  const records: SidecarDependencyProbe[] = [];
  const idByAnswerByPathByKind = {
    content: new Map<string, Map<string, number>>(),
    exists: new Map<string, Map<string, number>>(),
  };
  return {
    records,
    intern: (kind, relativePath, answer) => {
      const idByAnswerByPath = idByAnswerByPathByKind[kind];
      let idByAnswer = idByAnswerByPath.get(relativePath);
      if (idByAnswer === undefined) {
        idByAnswer = new Map<string, number>();
        idByAnswerByPath.set(relativePath, idByAnswer);
      }
      const existingId = idByAnswer.get(answer);
      if (existingId !== undefined) return existingId;
      const probeId = records.length;
      records.push({ kind, path: relativePath, answer });
      idByAnswer.set(answer, probeId);
      return probeId;
    },
  };
};

// Decodes a persisted bucket's probe table + raw file entries, dropping any
// entry whose probe ids fall outside the table (a truncated probe set would
// under-guard its diagnostics — the one direction that must never happen).
// Diagnostics are validated by the caller that materializes an entry.
const decodeRuleset = (raw: unknown): DecodedRuleset | null => {
  if (!isRecord(raw) || !Array.isArray(raw.probes) || !isRecord(raw.files)) return null;
  const probes: SidecarDependencyProbe[] = [];
  for (const rawProbe of raw.probes) {
    if (!Array.isArray(rawProbe) || rawProbe.length !== 3) return null;
    const [kind, probePath, answer] = rawProbe;
    if (!isProbeKind(kind) || typeof probePath !== "string" || typeof answer !== "string") {
      return null;
    }
    probes.push({ kind, path: probePath, answer });
  }
  const files = new Map<string, PersistedFileEntry>();
  for (const [fileKey, rawEntry] of Object.entries(raw.files)) {
    if (
      !isRecord(rawEntry) ||
      !isProbeIdArray(rawEntry.probeIds, probes.length) ||
      !Array.isArray(rawEntry.diagnostics)
    ) {
      continue;
    }
    files.set(fileKey, { probeIds: rawEntry.probeIds, diagnostics: rawEntry.diagnostics });
  }
  return { probes, files };
};

const validateDiagnostics = (raw: ReadonlyArray<unknown>): ReadonlyArray<Diagnostic> | null => {
  try {
    for (const entry of raw) validateDiagnostic(entry);
  } catch {
    return null;
  }
  return raw as ReadonlyArray<Diagnostic>;
};

// Re-interns a decoded bucket's probe ids into `table`, so entries from disk
// and entries stored this run share one id space.
const remapProbeIds = (
  decoded: DecodedRuleset,
  probeIds: ReadonlyArray<number>,
  table: ProbeTable,
  memoryIdByDiskId: number[],
): number[] =>
  probeIds.map((diskId) => {
    const memoized = memoryIdByDiskId[diskId];
    if (memoized !== undefined) return memoized;
    const probe = decoded.probes[diskId];
    const memoryId = table.intern(probe.kind, probe.path, probe.answer);
    memoryIdByDiskId[diskId] = memoryId;
    return memoryId;
  });

const emptyCache = (): PersistedSidecarLintCache => ({
  version: SIDECAR_LINT_CACHE_SCHEMA_VERSION,
  rulesets: {},
});

const readPersistedRulesets = (cacheFilePath: string): Record<string, unknown> => {
  const persisted = failOpenReadJson<PersistedSidecarLintCache>(cacheFilePath, emptyCache());
  return persisted.version === SIDECAR_LINT_CACHE_SCHEMA_VERSION && isRecord(persisted.rulesets)
    ? persisted.rulesets
    : {};
};

export const createSidecarLintCache = (
  cacheDirectory: string,
  rulesetHash: string,
): SidecarLintCache => {
  const cacheFilePath = path.join(cacheDirectory, SIDECAR_LINT_CACHE_FILENAME);
  const table = createProbeTable();
  const entries = new Map<string, SidecarFileEntry>();
  // Per-id verification memo: `undefined` unanswered, else whether the
  // record's stored answer still matches the current tree.
  const validityById: Array<boolean | undefined> = [];

  const loaded = decodeRuleset(readPersistedRulesets(cacheFilePath)[rulesetHash]);
  if (loaded !== null) {
    const memoryIdByDiskId: number[] = [];
    for (const [fileKey, persistedEntry] of loaded.files) {
      const diagnostics = validateDiagnostics(persistedEntry.diagnostics);
      if (diagnostics === null) continue;
      entries.set(fileKey, {
        probeIds: remapProbeIds(loaded, persistedEntry.probeIds, table, memoryIdByDiskId),
        diagnostics,
      });
    }
  }

  return {
    lookup: (fileKey) => entries.get(fileKey) ?? null,
    isReplayable: (entry, answerFor) => {
      for (const probeId of entry.probeIds) {
        let isValid = validityById[probeId];
        if (isValid === undefined) {
          const probe = table.records[probeId];
          isValid = answerFor(probe.kind, probe.path) === probe.answer;
          validityById[probeId] = isValid;
        }
        if (!isValid) return false;
      }
      return true;
    },
    internProbe: table.intern,
    probeAt: (probeId) => table.records[probeId],
    store: (fileKey, entry) => {
      // Re-insert so the most recently stored keys sort last — the LRU window
      // kept on persist is the tail of insertion order.
      entries.delete(fileKey);
      entries.set(fileKey, entry);
    },
    persist: () => {
      // Re-read so a sibling run writing a DIFFERENT ruleset bucket isn't
      // clobbered.
      const rulesets = { ...readPersistedRulesets(cacheFilePath) };

      // Merge — not replace — our ruleset bucket, mirroring the file cache:
      // a sibling run sharing this hash may have stored entries for files we
      // never touched; our entries win for any shared key. Sibling entries
      // are re-interned into our table so one compact table is written.
      const siblingBucket = decodeRuleset(rulesets[rulesetHash]);
      const mergedEntries = new Map<string, PersistedFileEntry>();
      if (siblingBucket !== null) {
        const memoryIdByDiskId: number[] = [];
        for (const [fileKey, persistedEntry] of siblingBucket.files) {
          if (entries.has(fileKey)) continue;
          mergedEntries.set(fileKey, {
            probeIds: remapProbeIds(
              siblingBucket,
              persistedEntry.probeIds,
              table,
              memoryIdByDiskId,
            ),
            diagnostics: persistedEntry.diagnostics,
          });
        }
      }
      for (const [fileKey, entry] of entries) mergedEntries.set(fileKey, entry);
      const cappedEntries = [...mergedEntries].slice(-FILE_LINT_CACHE_MAX_FILE_COUNT);

      // Compact the written table to the records the kept entries reference,
      // numbered in first-use order.
      const writtenIdByMemoryId = new Map<number, number>();
      const writtenProbes: PersistedProbe[] = [];
      const files: Record<string, PersistedFileEntry> = {};
      for (const [fileKey, entry] of cappedEntries) {
        files[fileKey] = {
          probeIds: entry.probeIds.map((memoryId) => {
            let writtenId = writtenIdByMemoryId.get(memoryId);
            if (writtenId === undefined) {
              writtenId = writtenProbes.length;
              const probe = table.records[memoryId];
              writtenProbes.push([probe.kind, probe.path, probe.answer]);
              writtenIdByMemoryId.set(memoryId, writtenId);
            }
            return writtenId;
          }),
          diagnostics: entry.diagnostics,
        };
      }
      rulesets[rulesetHash] = { updatedAtMs: Date.now(), probes: writtenProbes, files };

      const prunedRulesets = Object.fromEntries(
        Object.entries(rulesets)
          .filter(
            (bucketEntry): bucketEntry is [string, PersistedRuleset] =>
              isRecord(bucketEntry[1]) && typeof bucketEntry[1].updatedAtMs === "number",
          )
          .sort(([, first], [, second]) => second.updatedAtMs - first.updatedAtMs)
          .slice(0, FILE_LINT_CACHE_MAX_RULESET_COUNT),
      );

      atomicWriteJson(cacheFilePath, {
        version: SIDECAR_LINT_CACHE_SCHEMA_VERSION,
        rulesets: prunedRulesets,
      });
    },
  };
};
