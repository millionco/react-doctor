import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../src/types/index.js";
import {
  FILE_LINT_CACHE_FILENAME,
  FILE_LINT_CACHE_MAX_RULESET_COUNT,
  FILE_LINT_CACHE_SCHEMA_VERSION,
} from "../src/constants.js";
import { createFileLintCache } from "../src/runners/oxlint/file-lint-cache.js";

const tempRoots: string[] = [];
const makeCacheDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-file-lint-cache-"));
  tempRoots.push(dir);
  return dir;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-key",
  severity: "warning",
  message: "Avoid array index keys",
  help: "Use a stable id",
  line: 3,
  column: 5,
  category: "Correctness",
  ...overrides,
});

describe("createFileLintCache", () => {
  it("round-trips stored diagnostics across a persist + reload", () => {
    const cacheDir = makeCacheDir();
    const writer = createFileLintCache(cacheDir, "ruleset-1");
    writer.store("src/a.tsx hashA", [diagnostic({ filePath: "src/a.tsx" })]);
    writer.store("src/b.tsx hashB", []); // a clean file is a real cache hit, not a miss
    writer.persist();

    const reader = createFileLintCache(cacheDir, "ruleset-1");
    const replayed = reader.lookup("src/a.tsx hashA");
    expect(replayed).not.toBeNull();
    expect(replayed).toHaveLength(1);
    expect(replayed?.[0]?.filePath).toBe("src/a.tsx");
    expect(reader.lookup("src/b.tsx hashB")).toEqual([]);
    expect(reader.lookup("src/never-seen.tsx hashZ")).toBeNull();
  });

  it("isolates entries by ruleset hash (a toolchain/config change is a clean miss)", () => {
    const cacheDir = makeCacheDir();
    const writer = createFileLintCache(cacheDir, "ruleset-old");
    writer.store("src/a.tsx hashA", [diagnostic()]);
    writer.persist();

    const otherRuleset = createFileLintCache(cacheDir, "ruleset-new");
    expect(otherRuleset.lookup("src/a.tsx hashA")).toBeNull();
  });

  it("preserves sibling ruleset buckets when a different ruleset persists", () => {
    const cacheDir = makeCacheDir();
    const first = createFileLintCache(cacheDir, "ruleset-1");
    first.store("src/a.tsx hashA", [diagnostic()]);
    first.persist();

    const second = createFileLintCache(cacheDir, "ruleset-2");
    second.store("src/b.tsx hashB", [diagnostic({ filePath: "src/b.tsx" })]);
    second.persist();

    // ruleset-1's bucket survived ruleset-2's write.
    const reReadFirst = createFileLintCache(cacheDir, "ruleset-1");
    expect(reReadFirst.lookup("src/a.tsx hashA")).toHaveLength(1);
  });

  it("merges same-ruleset entries on persist (concurrent runs don't erase each other)", () => {
    const cacheDir = makeCacheDir();
    // Both runs load the (empty) cache before either persists — the concurrent
    // race. Each stores a DIFFERENT file under the SAME ruleset hash.
    const runA = createFileLintCache(cacheDir, "ruleset-shared");
    const runB = createFileLintCache(cacheDir, "ruleset-shared");
    runA.store("src/a.tsx hashA", [diagnostic({ filePath: "src/a.tsx" })]);
    runA.persist();
    runB.store("src/b.tsx hashB", [diagnostic({ filePath: "src/b.tsx" })]);
    runB.persist(); // re-reads runA's entry and merges, rather than replacing

    const reader = createFileLintCache(cacheDir, "ruleset-shared");
    expect(reader.lookup("src/a.tsx hashA")).toHaveLength(1);
    expect(reader.lookup("src/b.tsx hashB")).toHaveLength(1);
  });

  it("fails open on a corrupt cache file (no throw, treated as empty)", () => {
    const cacheDir = makeCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, FILE_LINT_CACHE_FILENAME), "{ this is not json");

    const cache = createFileLintCache(cacheDir, "ruleset-1");
    expect(cache.lookup("src/a.tsx hashA")).toBeNull();
    // Still usable: a store + persist over a corrupt file recovers cleanly.
    expect(() => {
      cache.store("src/a.tsx hashA", [diagnostic()]);
      cache.persist();
    }).not.toThrow();
  });

  it("degrades a file with a malformed diagnostic to a miss (never a partial set)", () => {
    const cacheDir = makeCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, FILE_LINT_CACHE_FILENAME),
      JSON.stringify({
        version: FILE_LINT_CACHE_SCHEMA_VERSION,
        rulesets: {
          "ruleset-1": {
            updatedAtMs: 1,
            files: {
              "src/bad.tsx hashBad": [{ filePath: "src/bad.tsx" /* missing required fields */ }],
              "src/ok.tsx hashOk": [],
            },
          },
        },
      }),
    );
    const cache = createFileLintCache(cacheDir, "ruleset-1");
    expect(cache.lookup("src/bad.tsx hashBad")).toBeNull();
    expect(cache.lookup("src/ok.tsx hashOk")).toEqual([]);
  });

  it("prunes the OLDEST ruleset buckets when over the cap (LRU by updatedAtMs)", () => {
    const cacheDir = makeCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    // Pre-seed MAX + 2 buckets with explicit ascending `updatedAtMs` so survivor
    // identity is deterministic — real `Date.now()` stamps tie in a tight loop,
    // which would let a "keep oldest" regression flake instead of fail.
    const seededCount = FILE_LINT_CACHE_MAX_RULESET_COUNT + 2;
    const seededRulesets: Record<string, unknown> = {};
    for (let index = 0; index < seededCount; index++) {
      seededRulesets[`seeded-${index}`] = {
        updatedAtMs: index, // ascending → seeded-0 is the oldest
        files: { [`src/file-${index}.tsx hash-${index}`]: [] },
      };
    }
    fs.writeFileSync(
      path.join(cacheDir, FILE_LINT_CACHE_FILENAME),
      JSON.stringify({ version: FILE_LINT_CACHE_SCHEMA_VERSION, rulesets: seededRulesets }),
    );

    // A fresh bucket persists with a real `Date.now()` — far larger than any
    // seeded integer, so unambiguously newest. Total = MAX + 3, pruned to MAX.
    const newest = createFileLintCache(cacheDir, "newest");
    newest.store("src/newest.tsx hash-newest", [diagnostic()]);
    newest.persist();

    const persisted = JSON.parse(
      fs.readFileSync(path.join(cacheDir, FILE_LINT_CACHE_FILENAME), "utf8"),
    );
    const survivingHashes = Object.keys(persisted.rulesets);
    // The prune is exact, not merely bounded.
    expect(survivingHashes.length).toBe(FILE_LINT_CACHE_MAX_RULESET_COUNT);
    // Newest + the highest-timestamp seeded bucket survived; the three
    // lowest-timestamp seeded buckets were dropped.
    expect(survivingHashes).toContain("newest");
    expect(survivingHashes).toContain(`seeded-${seededCount - 1}`);
    expect(survivingHashes).not.toContain("seeded-0");
    expect(survivingHashes).not.toContain("seeded-1");
    expect(survivingHashes).not.toContain("seeded-2");
  });
});
