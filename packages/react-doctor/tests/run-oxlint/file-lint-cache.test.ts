import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { buildDiagnosticIdentity, runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject, writeFile } from "../regressions/_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-file-lint-cache-e2e-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

// Both a cross-file (sidecar) rule and within-file (cacheable) rules fire on
// the shared fixture, so byte-identical assertions exercise both halves of the
// merge.
const USER_CONFIG = {
  rules: {
    "react-doctor/no-barrel-import": "warn",
    "react-doctor/no-array-index-key": "warn",
  },
} as const;

const BARREL_INDEX = "export { Button } from './Button';\n";
const NON_BARREL_INDEX = "export const Button = () => null;\n";
const APP_SOURCE = `import { Button } from "./components";
export const App = () => {
  const items = [1, 2, 3];
  return <ul>{items.map((value, index) => <li key={index}>{value}<Button /></li>)}</ul>;
};
`;

interface ScanOptions {
  perFileLintCacheEnabled?: boolean;
  respectInlineDisables?: boolean;
  hasReactCompiler?: boolean;
  includePaths?: string[];
  onCacheStats?: (cacheHitFileCount: number, totalConsideredFileCount: number) => void;
}

const setupFixture = (caseId: string, indexSource: string): string => {
  const projectDir = setupReactProject(tempRoot, caseId, {
    files: {
      "src/components/Button.tsx": "export const Button = () => null;\n",
      "src/components/index.ts": indexSource,
      "src/App.tsx": APP_SOURCE,
      "src/clean.tsx": "export const Clean = () => <div>ok</div>;\n",
    },
  });
  // A `node_modules` directory makes the cache land inside the fixture (cleaned
  // up with `tempRoot`) instead of the OS temp dir.
  fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
  return projectDir;
};

const scan = (projectDir: string, options: ScanOptions = {}): Promise<Diagnostic[]> =>
  runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({
      rootDirectory: projectDir,
      framework: "nextjs",
      hasReactCompiler: options.hasReactCompiler ?? false,
    }),
    userConfig: USER_CONFIG,
    includePaths: options.includePaths,
    respectInlineDisables: options.respectInlineDisables,
    perFileLintCacheEnabled: options.perFileLintCacheEnabled,
    onCacheStats: options.onCacheStats,
  });

// Deterministic serialization of a diagnostic set for byte-identical
// comparison: sort by identity, JSON-stringify (drops `undefined` optionals on
// both sides so a cache-decoded diagnostic compares equal to a fresh one).
const serialize = (diagnostics: ReadonlyArray<Diagnostic>): string =>
  JSON.stringify(
    [...diagnostics]
      .map((diagnostic) => ({ ...diagnostic }))
      .sort((first, second) =>
        buildDiagnosticIdentity(first).localeCompare(buildDiagnosticIdentity(second)),
      ),
  );

const noBarrelHitsOnApp = (diagnostics: ReadonlyArray<Diagnostic>): number =>
  diagnostics.filter(
    (diagnostic) => diagnostic.rule === "no-barrel-import" && diagnostic.filePath === "src/App.tsx",
  ).length;

describe("per-file lint cache", () => {
  it("produces byte-identical diagnostics with the cache on (warm) vs off", async () => {
    const projectDir = setupFixture("byte-identical", BARREL_INDEX);
    const withCacheOff = await scan(projectDir, { perFileLintCacheEnabled: false });
    const cold = await scan(projectDir, { perFileLintCacheEnabled: true });
    const warm = await scan(projectDir, { perFileLintCacheEnabled: true });

    expect(serialize(cold)).toBe(serialize(withCacheOff));
    expect(serialize(warm)).toBe(serialize(withCacheOff));
    // Sanity: the fixture actually produced diagnostics from both halves.
    expect(withCacheOff.some((diagnostic) => diagnostic.rule === "no-barrel-import")).toBe(true);
    expect(withCacheOff.some((diagnostic) => diagnostic.rule === "no-array-index-key")).toBe(true);
  });

  it("reports zero hits cold and full hits warm via onCacheStats", async () => {
    const projectDir = setupFixture("cache-stats", BARREL_INDEX);
    let coldHits: number | null = null;
    let coldTotal: number | null = null;
    let warmHits: number | null = null;
    let warmTotal: number | null = null;

    await scan(projectDir, {
      perFileLintCacheEnabled: true,
      onCacheStats: (hits, total) => {
        coldHits = hits;
        coldTotal = total;
      },
    });
    await scan(projectDir, {
      perFileLintCacheEnabled: true,
      onCacheStats: (hits, total) => {
        warmHits = hits;
        warmTotal = total;
      },
    });

    expect(coldHits).toBe(0);
    expect(coldTotal).toBeGreaterThan(0);
    // Nothing changed between the two scans, so every file is a hit.
    expect(warmHits).toBe(warmTotal);
    expect(warmTotal).toBe(coldTotal);
  });

  it("invalidates a file when its OWN content changes (content-addressed)", async () => {
    const projectDir = setupFixture("content-change", BARREL_INDEX);
    await scan(projectDir, { perFileLintCacheEnabled: true }); // populate

    // Fix the array-index-key violation in App.tsx (a cacheable rule).
    writeFile(
      path.join(projectDir, "src/App.tsx"),
      `import { Button } from "./components";
export const App = () => <div><Button /></div>;
`,
    );
    const afterEditCacheOn = await scan(projectDir, { perFileLintCacheEnabled: true });
    const afterEditCacheOff = await scan(projectDir, { perFileLintCacheEnabled: false });

    // The cacheable diagnostic is gone, and the cache-on result matches a
    // from-scratch scan of the edited tree.
    expect(serialize(afterEditCacheOn)).toBe(serialize(afterEditCacheOff));
    expect(afterEditCacheOn.some((diagnostic) => diagnostic.rule === "no-array-index-key")).toBe(
      false,
    );
  });

  it("never serves a stale cross-file verdict when a DEPENDENCY changes", async () => {
    const projectDir = setupFixture("cross-file-staleness", BARREL_INDEX);
    const whileBarrel = await scan(projectDir, { perFileLintCacheEnabled: true });
    expect(noBarrelHitsOnApp(whileBarrel)).toBe(1); // App.tsx imports a barrel → flagged

    // Change ONLY the dependency (the barrel becomes a direct definition).
    // App.tsx is byte-for-byte unchanged, so it's a cacheable-cache hit — but
    // no-barrel-import runs fresh in the sidecar and must see the new verdict.
    writeFile(path.join(projectDir, "src/components/index.ts"), NON_BARREL_INDEX);
    const afterDepChangeCacheOn = await scan(projectDir, { perFileLintCacheEnabled: true });
    const afterDepChangeCacheOff = await scan(projectDir, { perFileLintCacheEnabled: false });

    // The cross-file verdict flipped to fresh, matching a from-scratch scan —
    // no stale barrel diagnostic survived on the unchanged App.tsx.
    expect(noBarrelHitsOnApp(afterDepChangeCacheOn)).toBe(
      noBarrelHitsOnApp(afterDepChangeCacheOff),
    );
    expect(noBarrelHitsOnApp(afterDepChangeCacheOn)).toBe(0);
  });

  it("bypasses the cache in audit mode (respectInlineDisables: false)", async () => {
    const projectDir = setupFixture("audit-bypass", BARREL_INDEX);
    let cacheStatsCalled = false;
    const diagnostics = await scan(projectDir, {
      perFileLintCacheEnabled: true,
      respectInlineDisables: false,
      onCacheStats: () => {
        cacheStatsCalled = true;
      },
    });
    // Audit mode mutates files in place, so the cache must be bypassed entirely
    // (onCacheStats never fires) while diagnostics are still produced.
    expect(cacheStatsCalled).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.rule === "no-barrel-import")).toBe(true);
  });

  it("dedupes the merged result when includePaths repeats a file (matches cache-off)", async () => {
    const projectDir = setupFixture("dedupe-dup-paths", BARREL_INDEX);
    const duplicatedPaths = ["src/App.tsx", "src/App.tsx"];
    await scan(projectDir, { perFileLintCacheEnabled: true, includePaths: duplicatedPaths });
    const warm = await scan(projectDir, {
      perFileLintCacheEnabled: true,
      includePaths: duplicatedPaths,
    });
    const withCacheOff = await scan(projectDir, {
      perFileLintCacheEnabled: false,
      includePaths: duplicatedPaths,
    });
    // A duplicate path replays the cached set twice; the final dedupe collapses
    // it, so warm output equals a (deduped) cache-off scan rather than exceeding it.
    expect(serialize(warm)).toBe(serialize(withCacheOff));
  });

  it("bypasses the cache for React Compiler projects (react-hooks-js load-failure safety)", async () => {
    const projectDir = setupFixture("react-compiler-bypass", BARREL_INDEX);
    let cacheStatsCalled = false;
    const diagnostics = await scan(projectDir, {
      perFileLintCacheEnabled: true,
      hasReactCompiler: true,
      onCacheStats: () => {
        cacheStatsCalled = true;
      },
    });
    // react-hooks-js can fail to load mid-run; a zero-miss warm scan would never
    // re-trigger that, so React Compiler projects bypass the cache entirely.
    expect(cacheStatsCalled).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.rule === "no-barrel-import")).toBe(true);
  });
});
