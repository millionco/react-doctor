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
import type { SidecarFileEntry } from "../src/runners/oxlint/sidecar-lint-cache.js";

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

const entry = (overrides: Partial<SidecarFileEntry> = {}): SidecarFileEntry => ({
  probes: [
    { kind: "content", path: "src/components/index.ts", answer: "hash-index" },
    { kind: "exists", path: "src/components.tsx", answer: "none" },
  ],
  diagnostics: [diagnostic()],
  ...overrides,
});

describe("createSidecarLintCache", () => {
  it("round-trips probes + diagnostics across a persist + reload", () => {
    const cacheDir = makeCacheDir();
    const writer = createSidecarLintCache(cacheDir, "ruleset-1");
    writer.store("src/app.tsx hashA", entry());
    writer.store("src/clean.tsx hashB", entry({ diagnostics: [] }));
    writer.persist();

    const reader = createSidecarLintCache(cacheDir, "ruleset-1");
    const replayed = reader.lookup("src/app.tsx hashA");
    expect(replayed).not.toBeNull();
    expect(replayed?.probes).toEqual(entry().probes);
    expect(replayed?.diagnostics).toHaveLength(1);
    expect(reader.lookup("src/clean.tsx hashB")?.diagnostics).toEqual([]);
    expect(reader.lookup("src/never-seen.tsx hashZ")).toBeNull();
  });

  it("isolates entries by ruleset hash (a toolchain/config change is a clean miss)", () => {
    const cacheDir = makeCacheDir();
    const writer = createSidecarLintCache(cacheDir, "ruleset-1");
    writer.store("src/app.tsx hashA", entry());
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
            files: {
              "src/app.tsx hashA": {
                // A probe tuple missing its answer — replaying diagnostics
                // guarded by a truncated probe set could serve a stale verdict.
                probes: [["content", "src/components/index.ts"]],
                diagnostics: [diagnostic()],
              },
            },
          },
        },
      }),
    );
    expect(createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA")).toBeNull();
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
            files: {
              "src/app.tsx hashA": {
                probes: [],
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
    cache.store("src/app.tsx hashA", entry());
    expect(() => cache.persist()).not.toThrow();
    expect(
      createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA"),
    ).not.toBeNull();
  });

  it("preserves sibling ruleset buckets when a different ruleset persists", () => {
    const cacheDir = makeCacheDir();
    const first = createSidecarLintCache(cacheDir, "ruleset-1");
    first.store("src/app.tsx hashA", entry());
    first.persist();

    const second = createSidecarLintCache(cacheDir, "ruleset-2");
    second.store("src/other.tsx hashB", entry({ diagnostics: [] }));
    second.persist();

    expect(
      createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA"),
    ).not.toBeNull();
    expect(
      createSidecarLintCache(cacheDir, "ruleset-2").lookup("src/other.tsx hashB"),
    ).not.toBeNull();
  });
});
