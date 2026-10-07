import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../src/types/index.js";
import {
  SIDECAR_LINT_CACHE_FILENAME,
  SIDECAR_LINT_CACHE_SCHEMA_VERSION,
} from "../src/constants.js";
import { createSidecarLintCache } from "../src/runners/oxlint/sidecar-lint-cache.js";
import type {
  SidecarDependencyProbe,
  SidecarFileEntry,
  SidecarLintCache,
} from "../src/runners/oxlint/sidecar-lint-cache.js";

const tempRoots: string[] = [];
const makeCacheDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-sidecar-lint-cache-"));
  tempRoots.push(dir);
  return dir;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "no-barrel-import",
  severity: "warning",
  message: "Import from a barrel file",
  help: "Import directly",
  line: 1,
  column: 1,
  category: "Bundle Size",
  ...overrides,
});

const PROBES: ReadonlyArray<SidecarDependencyProbe> = [
  { kind: "content", path: "src/components/index.ts", answer: "hash-index" },
  { kind: "exists", path: "src/components.tsx", answer: "none" },
];

const internProbes = (
  cache: SidecarLintCache,
  probes: ReadonlyArray<SidecarDependencyProbe> = PROBES,
): number[] => probes.map((probe) => cache.internProbe(probe.kind, probe.path, probe.answer));

const entry = (
  cache: SidecarLintCache,
  overrides: Partial<SidecarFileEntry> = {},
): SidecarFileEntry => ({
  probeIds: internProbes(cache),
  diagnostics: [diagnostic()],
  ...overrides,
});

const probesOf = (cache: SidecarLintCache, cached: SidecarFileEntry | null) =>
  cached?.probeIds.map((probeId) => cache.probeAt(probeId));

const answerFromProbes =
  (probes: ReadonlyArray<SidecarDependencyProbe>) =>
  (kind: SidecarDependencyProbe["kind"], probePath: string): string =>
    probes.find((probe) => probe.kind === kind && probe.path === probePath)?.answer ?? "absent";

describe("createSidecarLintCache", () => {
  it("round-trips probes + diagnostics across a persist + reload", () => {
    const cacheDir = makeCacheDir();
    const writer = createSidecarLintCache(cacheDir, "ruleset-1");
    writer.store("src/app.tsx hashA", entry(writer));
    writer.store("src/clean.tsx hashB", entry(writer, { diagnostics: [] }));
    writer.persist();

    const reader = createSidecarLintCache(cacheDir, "ruleset-1");
    const replayed = reader.lookup("src/app.tsx hashA");
    expect(replayed).not.toBeNull();
    expect(probesOf(reader, replayed)).toEqual(PROBES);
    expect(replayed?.diagnostics).toHaveLength(1);
    expect(reader.lookup("src/clean.tsx hashB")?.diagnostics).toEqual([]);
    expect(reader.lookup("src/never-seen.tsx hashZ")).toBeNull();
  });

  it("interns one record per distinct (kind, path, answer) across entries", () => {
    const cacheDir = makeCacheDir();
    const writer = createSidecarLintCache(cacheDir, "ruleset-1");
    writer.store("src/app.tsx hashA", entry(writer));
    writer.store("src/other.tsx hashB", entry(writer));
    const staleProbes = [{ ...PROBES[0], answer: "hash-index-old" }];
    writer.store("src/stale.tsx hashC", {
      probeIds: internProbes(writer, staleProbes),
      diagnostics: [],
    });
    writer.persist();

    const persisted = JSON.parse(
      fs.readFileSync(path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME), "utf8"),
    );
    const bucket = persisted.rulesets["ruleset-1"];
    expect(bucket.probes).toHaveLength(3);
    expect(bucket.files["src/app.tsx hashA"].probeIds).toEqual(
      bucket.files["src/other.tsx hashB"].probeIds,
    );

    const reader = createSidecarLintCache(cacheDir, "ruleset-1");
    const answerFor = answerFromProbes(PROBES);
    expect(reader.isReplayable(reader.lookup("src/app.tsx hashA")!, answerFor)).toBe(true);
    expect(reader.isReplayable(reader.lookup("src/stale.tsx hashC")!, answerFor)).toBe(false);
  });

  it("answers each distinct probe once per cache instance while verifying", () => {
    const cacheDir = makeCacheDir();
    const cache = createSidecarLintCache(cacheDir, "ruleset-1");
    const first = entry(cache);
    const second = entry(cache);
    let answerCount = 0;
    const answerFor = (kind: SidecarDependencyProbe["kind"], probePath: string): string => {
      answerCount += 1;
      return answerFromProbes(PROBES)(kind, probePath);
    };
    expect(cache.isReplayable(first, answerFor)).toBe(true);
    expect(cache.isReplayable(second, answerFor)).toBe(true);
    expect(answerCount).toBe(PROBES.length);
  });

  it("keeps sibling entries (re-interned) when persisting over a bucket another run wrote", () => {
    const cacheDir = makeCacheDir();
    const sibling = createSidecarLintCache(cacheDir, "ruleset-1");
    sibling.store("src/sibling.tsx hashS", entry(sibling));
    const ours = createSidecarLintCache(cacheDir, "ruleset-1");
    sibling.persist();
    ours.store("src/app.tsx hashA", entry(ours, { diagnostics: [] }));
    ours.persist();

    const reader = createSidecarLintCache(cacheDir, "ruleset-1");
    expect(probesOf(reader, reader.lookup("src/sibling.tsx hashS"))).toEqual(PROBES);
    expect(reader.lookup("src/app.tsx hashA")?.diagnostics).toEqual([]);
  });

  it("isolates entries by ruleset hash (a toolchain/config change is a clean miss)", () => {
    const cacheDir = makeCacheDir();
    const writer = createSidecarLintCache(cacheDir, "ruleset-1");
    writer.store("src/app.tsx hashA", entry(writer));
    writer.persist();

    expect(createSidecarLintCache(cacheDir, "ruleset-2").lookup("src/app.tsx hashA")).toBeNull();
  });

  it("degrades an entry with a malformed probe to a miss (never a partial guard)", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(
      path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME),
      JSON.stringify({
        version: SIDECAR_LINT_CACHE_SCHEMA_VERSION,
        rulesets: {
          "ruleset-1": {
            updatedAtMs: Date.now(),
            // A probe record missing its answer — replaying diagnostics
            // guarded by a truncated probe set could serve a stale verdict.
            probes: [["content", "src/components/index.ts"]],
            files: {
              "src/app.tsx hashA": {
                probeIds: [0],
                diagnostics: [diagnostic()],
              },
            },
          },
        },
      }),
    );
    expect(createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA")).toBeNull();
  });

  it("degrades an entry referencing a probe id outside the table to a miss", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(
      path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME),
      JSON.stringify({
        version: SIDECAR_LINT_CACHE_SCHEMA_VERSION,
        rulesets: {
          "ruleset-1": {
            updatedAtMs: Date.now(),
            probes: [["content", "src/components/index.ts", "hash-index"]],
            files: {
              "src/app.tsx hashA": { probeIds: [0, 1], diagnostics: [diagnostic()] },
              "src/ok.tsx hashB": { probeIds: [0], diagnostics: [] },
            },
          },
        },
      }),
    );
    const cache = createSidecarLintCache(cacheDir, "ruleset-1");
    expect(cache.lookup("src/app.tsx hashA")).toBeNull();
    expect(cache.lookup("src/ok.tsx hashB")).not.toBeNull();
  });

  it("degrades an entry with a malformed diagnostic to a miss", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(
      path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME),
      JSON.stringify({
        version: SIDECAR_LINT_CACHE_SCHEMA_VERSION,
        rulesets: {
          "ruleset-1": {
            updatedAtMs: Date.now(),
            probes: [],
            files: {
              "src/app.tsx hashA": {
                probeIds: [],
                diagnostics: [{ notADiagnostic: true }],
              },
            },
          },
        },
      }),
    );
    expect(createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA")).toBeNull();
  });

  it("fails open on a corrupt cache file (no throw, treated as empty)", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME), "{ not json !!");
    const cache = createSidecarLintCache(cacheDir, "ruleset-1");
    expect(cache.lookup("src/app.tsx hashA")).toBeNull();
    cache.store("src/app.tsx hashA", entry(cache));
    expect(() => cache.persist()).not.toThrow();
    expect(
      createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA"),
    ).not.toBeNull();
  });

  it("preserves sibling ruleset buckets when a different ruleset persists", () => {
    const cacheDir = makeCacheDir();
    const first = createSidecarLintCache(cacheDir, "ruleset-1");
    first.store("src/app.tsx hashA", entry(first));
    first.persist();

    const second = createSidecarLintCache(cacheDir, "ruleset-2");
    second.store("src/other.tsx hashB", entry(second, { diagnostics: [] }));
    second.persist();

    expect(
      createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA"),
    ).not.toBeNull();
    expect(
      createSidecarLintCache(cacheDir, "ruleset-2").lookup("src/other.tsx hashB"),
    ).not.toBeNull();
  });
});
