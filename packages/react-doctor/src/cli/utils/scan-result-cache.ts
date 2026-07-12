import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  computeConfigFingerprint,
  hashFileContents,
  resolveLintBatchOrdering,
  resolveReactDoctorCacheDir,
} from "@react-doctor/core";
import type {
  Diagnostic,
  InspectOutput,
  InspectResult,
  ReactDoctorConfig,
  ScoreResult,
  SuppressedRuleCount,
} from "@react-doctor/core";
import {
  SCAN_RESULT_CACHE_FILENAME,
  SCAN_RESULT_CACHE_MAX_DIRTY_STATUS_ENTRY_COUNT,
  SCAN_RESULT_CACHE_MAX_ENTRY_COUNT,
  SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES,
  SCAN_RESULT_CACHE_SCHEMA_VERSION,
} from "./constants.js";
import { getPackageJsonPath, isRecord, runGit } from "./git-hook-shared.js";
import type { ResolvedInspectOptions } from "../../inspect.js";

export interface CachedScanPayload {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly project: InspectResult["project"];
  readonly userConfig: ReactDoctorConfig | null;
  readonly didLintFail: boolean;
  readonly lintFailureReason: string | null;
  readonly lintPartialFailures: ReadonlyArray<string>;
  readonly didDeadCodeFail: boolean;
  readonly deadCodeFailureReason: string | null;
  readonly deadCodeOverlapped: boolean;
  readonly directory: string;
  readonly scannedFileCount: number;
  readonly scannedFilePaths: ReadonlyArray<string>;
  readonly analyzedFiles?: ReadonlyArray<string>;
  readonly scanElapsedMilliseconds: number;
  readonly baselineDelta: InspectResult["baselineDelta"];
  readonly lintFailureReasonKind: InspectOutput["lintFailureReasonKind"];
  /**
   * Resolved lint worker count (`InspectOutput["scanConcurrency"]`), surfaced
   * for telemetry. Optional so cache entries persisted before this field
   * existed still load — a stale hit falls back to the caller's `concurrency`.
   */
  readonly scanConcurrency?: number;
  readonly supplyChainOverlapTimedOut: boolean;
  /**
   * `InspectOutput["securityScanFailed"]`, surfaced for telemetry. Optional so
   * cache entries persisted before this field existed still load; a failed
   * pass is never cached (`shouldStoreScanPayload`), so a stale hit's
   * `undefined` reads as the healthy `false`.
   */
  readonly securityScanFailed?: boolean;
  /**
   * `InspectOutput["suppressedRuleCounts"]` — deterministic for a given
   * commit + config (part of the cache key), so a cache hit replays the same
   * suppression telemetry the fresh scan emitted.
   */
  readonly suppressedRuleCounts: ReadonlyArray<SuppressedRuleCount>;
  /**
   * Content hash of the project's `package.json` when the payload was stored
   * (`null` when the project has none). Stamped by `store` and re-checked by
   * `lookup` independently of the cache key, so any keying bug of the
   * same-path-different-project class surfaces as a miss instead of silently
   * replaying another project's diagnostics.
   */
  readonly manifestContentHash?: string | null;
}

interface PersistedScanResultCacheEntry {
  readonly key: string;
  readonly createdAtMs: number;
  readonly payload: CachedScanPayload;
}

interface PersistedScanResultCache {
  readonly version: number;
  readonly entries: ReadonlyArray<PersistedScanResultCacheEntry>;
}

interface ScanResultCache {
  readonly lookup: (key: string) => CachedScanPayload | null;
  readonly store: (key: string, payload: CachedScanPayload) => void;
}

interface ScanResultCacheKeyInput {
  readonly projectDirectory: string;
  readonly version: string;
  readonly nodeBinaryPath: string | null;
  readonly options: ResolvedInspectOptions;
  readonly userConfig: ReactDoctorConfig | null;
  readonly hasConfigOverride: boolean;
  readonly configSourceDirectory: string | null;
}

const CACHE_DISABLED_VALUES = new Set(["1", "true"]);
const TOOLCHAIN_PACKAGE_SPECIFIERS = [
  "oxlint/package.json",
  "oxlint-plugin-react-doctor/package.json",
  "deslop-js/package.json",
  "eslint-plugin-react-hooks/package.json",
] as const;
const bundledRequire = createRequire(import.meta.url);

interface PackageVersionView {
  readonly version?: unknown;
}

const normalizeForStableJson = (value: unknown): unknown => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") return value;
  if (valueType === "bigint" || valueType === "function" || valueType === "symbol") {
    throw new Error("Unsupported cache key value");
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const normalized = normalizeForStableJson(item);
      return normalized === undefined ? null : normalized;
    });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Unsupported cache key object");
  }
  if (!isRecord(value)) throw new Error("Unsupported cache key object");
  const normalizedRecord: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const normalized = normalizeForStableJson(value[key]);
    if (normalized !== undefined) normalizedRecord[key] = normalized;
  }
  return normalizedRecord;
};

const stringifyStableJson = (value: unknown): string | null => {
  try {
    return JSON.stringify(normalizeForStableJson(value));
  } catch {
    return null;
  }
};

const hashString = (value: string): string => crypto.createHash("sha1").update(value).digest("hex");

const readHeadSha = (projectDirectory: string): string | null =>
  runGit(projectDirectory, ["rev-parse", "HEAD"]);

interface WorktreeStatusEntry {
  readonly statusCode: string;
  readonly path: string;
  readonly originPath?: string;
}

interface WorktreeDirtyEntry extends WorktreeStatusEntry {
  readonly contentFingerprint: string;
}

const parseWorktreeStatusRecords = (statusOutput: string): WorktreeStatusEntry[] | null => {
  const entries: WorktreeStatusEntry[] = [];
  const tokens = statusOutput.split("\0");
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    let record = tokens[tokenIndex];
    if (record.length === 0) continue;
    // HACK: `runGit` trims subprocess output, which strips the leading space
    // of the FIRST record's two-character status code (e.g. " M"). A valid
    // porcelain v1 record always has the separator space at index 2, and X/Y
    // are never both spaces, so a first record missing that separator lost
    // exactly one leading space — restore it. Any later malformed record
    // means the parse desynced: bail rather than fingerprint garbage.
    if (record.length < 3 || record[2] !== " ") {
      if (tokenIndex !== 0) return null;
      record = ` ${record}`;
    }
    if (record.length < 4 || record[2] !== " ") return null;
    const statusCode = record.slice(0, 2);
    const recordPath = record.slice(3);
    if (statusCode.includes("R") || statusCode.includes("C")) {
      // Rename/copy records carry a second NUL-terminated field: the origin
      // path (`XY to NUL from NUL`).
      tokenIndex += 1;
      const originPath: string | undefined = tokens[tokenIndex];
      if (originPath === undefined || originPath.length === 0) return null;
      entries.push({ statusCode, path: recordPath, originPath });
      continue;
    }
    entries.push({ statusCode, path: recordPath });
  }
  return entries;
};

const buildDirtyPathContentFingerprint = (
  absolutePath: string,
  statusCode: string,
): string | null => {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(absolutePath);
  } catch {
    // A deleted path has no content to hash; the status code in the entry
    // already distinguishes a deletion from every other state at that path.
    return statusCode.includes("D") ? "deleted" : null;
  }
  if (stats.isSymbolicLink()) {
    try {
      return `link:${fs.readlinkSync(absolutePath)}`;
    } catch {
      return null;
    }
  }
  // A non-regular file (a dirty submodule shows as a directory) has no
  // cheaply-hashable content — bail so the cache stays off rather than risk
  // serving a stale payload for an unfingerprintable state.
  if (!stats.isFile()) return null;
  if (stats.size > SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES) {
    return null;
  }
  return hashFileContents(absolutePath);
};

// Fingerprints every divergence of the worktree from HEAD as
// (status code, path[, origin path], content fingerprint), so identical dirty
// states key identically and any content or index change shifts the key.
// Returns [] for a clean tree and null when the state cannot be fingerprinted
// (git failure, oversized dirty set, unfingerprintable path) — the caller
// treats null exactly like the old dirty-tree bail: cache off.
const buildWorktreeFingerprint = (
  projectDirectory: string,
): ReadonlyArray<WorktreeDirtyEntry> | null => {
  const statusOutput = runGit(projectDirectory, [
    "status",
    "--porcelain=v1",
    "-z",
    // `all` expands untracked directories into their contained files so each
    // one is content-fingerprinted; the entry-count bound below caps the cost.
    "--untracked-files=all",
  ]);
  if (statusOutput === null) return null;
  if (statusOutput.length === 0) return [];
  const statusEntries = parseWorktreeStatusRecords(statusOutput);
  if (statusEntries === null) return null;
  if (statusEntries.length > SCAN_RESULT_CACHE_MAX_DIRTY_STATUS_ENTRY_COUNT) return null;
  // Porcelain paths are relative to the repository root, not the (possibly
  // nested workspace-member) project directory.
  const repositoryRoot = runGit(projectDirectory, ["rev-parse", "--show-toplevel"]);
  if (repositoryRoot === null) return null;
  const dirtyEntries: WorktreeDirtyEntry[] = [];
  for (const statusEntry of statusEntries) {
    const contentFingerprint = buildDirtyPathContentFingerprint(
      path.join(repositoryRoot, statusEntry.path),
      statusEntry.statusCode,
    );
    if (contentFingerprint === null) return null;
    dirtyEntries.push({ ...statusEntry, contentFingerprint });
  }
  // Codepoint compare (not localeCompare) so the ordering — and therefore the
  // key — never varies with the process locale or ICU version.
  return dirtyEntries.sort((firstEntry, secondEntry) => {
    const firstSortKey = `${firstEntry.path}${firstEntry.statusCode}`;
    const secondSortKey = `${secondEntry.path}${secondEntry.statusCode}`;
    return firstSortKey < secondSortKey ? -1 : firstSortKey > secondSortKey ? 1 : 0;
  });
};

const DOTENV_FILE_NAME_PATTERN = /^\.env(\.|$)/;

// The security scan reads dotenv files even when they're gitignored — a state
// `git status` can never surface — so their content is keyed explicitly, the
// same coverage `computeConfigFingerprint` gives gitignored config files.
// Content-hashed (dotenv files are tiny) rather than stat-fingerprinted so a
// fresh CI checkout of identical content keys identically.
const resolveDotenvFingerprint = (projectDirectory: string): ReadonlyArray<string> => {
  try {
    return fs
      .readdirSync(projectDirectory)
      .filter((entryName) => DOTENV_FILE_NAME_PATTERN.test(entryName))
      .sort()
      .map(
        (entryName) =>
          `${entryName}=${hashFileContents(path.join(projectDirectory, entryName)) ?? "unreadable"}`,
      );
  } catch {
    return [];
  }
};

// Whether the repository git resolves for the project directory can be
// trusted as cache-key identity. `git ls-files -v` (restricted to the project
// directory by cwd) refutes that two ways: zero entries means the repository
// tracks nothing here — the project directory is a gitignored or untracked
// checkout (e.g. a .git-less clone nested inside an unrelated repository), so
// HEAD and `git status` describe a repository that cannot see the project's
// files and different project contents would key identically; a non-"H"
// entry means assume-unchanged / skip-worktree bits hide tracked-file changes
// from every fingerprint built on `git status`.
const isGitIdentityTrustworthy = (projectDirectory: string): boolean => {
  const output = runGit(projectDirectory, ["ls-files", "-v"]);
  if (output === null) return false;
  const entryLines = output.split("\n").filter((line) => line.length > 0);
  return entryLines.length > 0 && entryLines.every((line) => line[0] === "H");
};

// Sits beside the per-file lint / sidecar / dead-code caches under the shared
// cache root, so the `REACT_DOCTOR_CACHE_DIR` override the GitHub Action sets
// (a `${runner.temp}` path persisted by `actions/cache`) carries the whole-repo
// scan cache across CI runs too — the project-local `node_modules/.cache`
// default never survives a fresh, SHA-scoped checkout.
const resolveCacheFilePath = (projectDirectory: string): string =>
  path.join(resolveReactDoctorCacheDir(projectDirectory), SCAN_RESULT_CACHE_FILENAME);

const readPersistedCache = (cacheFilePath: string): PersistedScanResultCache => {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFilePath, "utf8"));
    if (!isRecord(parsed) || parsed.version !== SCAN_RESULT_CACHE_SCHEMA_VERSION) {
      return { version: SCAN_RESULT_CACHE_SCHEMA_VERSION, entries: [] };
    }
    if (!Array.isArray(parsed.entries)) {
      return { version: SCAN_RESULT_CACHE_SCHEMA_VERSION, entries: [] };
    }
    const entries: PersistedScanResultCacheEntry[] = [];
    for (const entry of parsed.entries) {
      if (
        !isRecord(entry) ||
        typeof entry.key !== "string" ||
        typeof entry.createdAtMs !== "number"
      ) {
        continue;
      }
      if (!isRecord(entry.payload) || !Array.isArray(entry.payload.diagnostics)) continue;
      entries.push(entry as unknown as PersistedScanResultCacheEntry);
    }
    return { version: SCAN_RESULT_CACHE_SCHEMA_VERSION, entries };
  } catch {
    return { version: SCAN_RESULT_CACHE_SCHEMA_VERSION, entries: [] };
  }
};

const writePersistedCache = (cacheFilePath: string, cache: PersistedScanResultCache): void => {
  try {
    fs.mkdirSync(path.dirname(cacheFilePath), { recursive: true });
    const tempPath = `${cacheFilePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(cache));
    fs.renameSync(tempPath, cacheFilePath);
  } catch {
    return;
  }
};

/**
 * The global cache off-switch (`REACT_DOCTOR_NO_CACHE`), which disables every
 * cache subsystem: this whole-repo scan cache plus core's per-file lint,
 * sidecar, and dead-code caches (their `Context.Reference` defaults read the
 * same variable). Exported for the wide event's `cache.temperature`
 * derivation, which reports `"disabled"` instead of `"cold"` when the switch
 * is on. Granular knobs (`REACT_DOCTOR_NO_FILE_CACHE`, …) are deliberately
 * not consulted — they leave the other subsystems live.
 */
export const isCacheGloballyDisabled = (): boolean =>
  CACHE_DISABLED_VALUES.has(process.env.REACT_DOCTOR_NO_CACHE?.toLowerCase() ?? "");

const resolveProjectIdentity = (projectDirectory: string): string => {
  try {
    return fs.realpathSync.native(projectDirectory);
  } catch {
    return path.resolve(projectDirectory);
  }
};

const resolveManifestContentHash = (projectDirectory: string): string | null =>
  hashFileContents(getPackageJsonPath(projectDirectory));

const fileFingerprint = (filePath: string): string | null => {
  try {
    const stat = fs.statSync(filePath);
    return `${filePath}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
};

// Versioned (not file-fingerprinted) like the lint ruleset hash, so the key
// survives a restored/re-extracted install in CI — extraction mtimes are an
// implementation detail of the installer, not toolchain identity. The one
// exception: a foreign oxlint Node (the nvm fallback) keeps the conservative
// stat identity rather than paying a version-probe subprocess here.
const resolveToolchainFingerprint = (nodeBinaryPath: string | null): ReadonlyArray<string> => {
  const fingerprints: string[] = [];
  if (nodeBinaryPath !== null) {
    fingerprints.push(
      nodeBinaryPath === process.execPath
        ? `node=${process.version}`
        : `node=${fileFingerprint(nodeBinaryPath) ?? "unreadable"}`,
    );
  }
  for (const specifier of TOOLCHAIN_PACKAGE_SPECIFIERS) {
    try {
      const packageJson = bundledRequire(specifier) as PackageVersionView;
      const version = typeof packageJson.version === "string" ? packageJson.version : "unknown";
      fingerprints.push(`${specifier}=${version}`);
    } catch {
      fingerprints.push(`${specifier}=missing`);
    }
  }
  return fingerprints;
};

export const buildScanResultCacheKey = (input: ScanResultCacheKeyInput): string | null => {
  if (isCacheGloballyDisabled()) return null;
  if (!isGitIdentityTrustworthy(input.projectDirectory)) return null;
  const worktreeFingerprint = buildWorktreeFingerprint(input.projectDirectory);
  if (worktreeFingerprint === null) return null;
  const headSha = readHeadSha(input.projectDirectory);
  if (headSha === null) return null;
  const userConfigJson = stringifyStableJson(input.userConfig);
  if (userConfigJson === null) return null;
  const cacheKeyJson = stringifyStableJson({
    schemaVersion: SCAN_RESULT_CACHE_SCHEMA_VERSION,
    projectIdentity: resolveProjectIdentity(input.projectDirectory),
    headSha,
    worktreeFingerprint,
    dotenvFingerprint: resolveDotenvFingerprint(input.projectDirectory),
    reactDoctorVersion: input.version,
    nodeVersion: process.version,
    toolchainFingerprint: resolveToolchainFingerprint(input.nodeBinaryPath),
    configFingerprint: computeConfigFingerprint(input.projectDirectory, input.version),
    hasConfigOverride: input.hasConfigOverride,
    configSourceDirectory: input.configSourceDirectory,
    userConfig: input.userConfig,
    engineOptions: {
      lint: input.options.lint,
      deadCode: input.options.deadCode,
      // Resolved supply-chain enablement (the `--supply-chain` flag over
      // config). Keyed here — not just via `userConfig` — because the flag can
      // flip it without touching the config blob, so a `--no-supply-chain`
      // lookup must not serve a supply-chain-on payload at the same commit.
      supplyChain: input.options.supplyChain,
      includePaths: [...input.options.includePaths].sort(),
      customRulesOnly: input.options.customRulesOnly,
      respectInlineDisables: input.options.respectInlineDisables,
      warnings: input.options.warnings,
      adoptExistingLintConfig: input.options.adoptExistingLintConfig,
      ignoredTags: [...input.options.ignoredTags].sort(),
      concurrency: input.options.concurrency,
      // Full-scan batch ordering can change which files trip the spawn
      // timeout and get dropped, so — like `concurrency` above — it must key
      // the cache: a `cost` run must not serve its payload to an `arrival`
      // lookup at the same commit.
      lintBatchOrdering: resolveLintBatchOrdering(),
      baselineRef: input.options.baseline?.ref,
      // `null` (not a `lines` scope) and an omitted field hash identically, so a
      // non-lines lookup matches a non-lines store; only real ranges shift the key.
      changedLineRanges: input.options.changedLineRanges ?? undefined,
      noScore: input.options.noScore,
      isCi: input.options.isCi,
      suppressRendering: input.options.suppressRendering,
      supplyChainManifestChanged: input.options.supplyChainManifestChanged,
      // `maxDurationMs` is deliberately NOT keyed. It only changes the RESULT
      // when the budget is hit, and every such truncated run (lint partial or
      // dead-code skipped) is barred from the cache by `shouldStoreScanPayload`
      // below. So a stored payload is always COMPLETE, and serving it to a
      // `--max-duration` lookup honors the budget (a cache hit finishes well
      // under any ceiling) with the best possible result. Keying on it would
      // only force needless misses that could downgrade a complete cached
      // result to a freshly-truncated partial one.
    },
  });
  return cacheKeyJson === null ? null : hashString(cacheKeyJson);
};

export const createScanResultCache = (projectDirectory: string): ScanResultCache => {
  const cacheFilePath = resolveCacheFilePath(projectDirectory);
  const persistedCache = readPersistedCache(cacheFilePath);
  const entries = new Map<string, PersistedScanResultCacheEntry>();
  for (const entry of persistedCache.entries) entries.set(entry.key, entry);

  const persist = (): void => {
    const prunedEntries = [...entries.values()]
      .sort((firstEntry, secondEntry) => secondEntry.createdAtMs - firstEntry.createdAtMs)
      .slice(0, SCAN_RESULT_CACHE_MAX_ENTRY_COUNT);
    writePersistedCache(cacheFilePath, {
      version: SCAN_RESULT_CACHE_SCHEMA_VERSION,
      entries: prunedEntries,
    });
  };

  return {
    lookup: (key) => {
      const payload = entries.get(key)?.payload;
      if (payload === undefined) return null;
      // Replay guard, independent of the key: a served payload must describe
      // THIS project — same directory identity and same manifest content as
      // when it was stored — so a keying bug degrades to a miss, never to
      // another project's diagnostics.
      const describesThisProject =
        resolveProjectIdentity(payload.directory) === resolveProjectIdentity(projectDirectory) &&
        (payload.manifestContentHash ?? null) === resolveManifestContentHash(projectDirectory);
      return describesThisProject ? payload : null;
    },
    store: (key, payload) => {
      entries.set(key, {
        key,
        createdAtMs: Date.now(),
        payload: { ...payload, manifestContentHash: resolveManifestContentHash(projectDirectory) },
      });
      persist();
    },
  };
};

export const shouldStoreScanPayload = (payload: CachedScanPayload): boolean =>
  !payload.didLintFail &&
  !payload.didDeadCodeFail &&
  payload.lintPartialFailures.length === 0 &&
  // A supply-chain overlap timeout means the cached diagnostics are missing
  // their supply-chain findings; don't persist a degraded result — re-attempt
  // the check on the next run instead. This also keeps the timeout kill metric
  // clean: a stored payload therefore always carries
  // `supplyChainOverlapTimedOut: false`, so a cache hit never replays a stale
  // `true`.
  !payload.supplyChainOverlapTimedOut &&
  // Same reasoning for a failed (fail-open) security scan: its diagnostics
  // are missing the whole pass, so the result must not be replayed.
  payload.securityScanFailed !== true;
