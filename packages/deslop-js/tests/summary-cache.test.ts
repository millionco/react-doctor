import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { dirname, join, relative } from "node:path";
import { analyze, defineConfig } from "../src/index.js";
import type { DeslopConfig, ScanResult } from "../src/types.js";
import { SUMMARY_CACHE_SCHEMA_VERSION } from "../src/constants.js";
import { loadSummaryCache } from "../src/summary-cache.js";

// Canonicalized so deslop's fast-glob paths line up with oxc-resolver's —
// `os.tmpdir()` is a symlink into /private on macOS.
const temporaryRoot = realpathSync(mkdtempSync(join(os.tmpdir(), "deslop-summary-cache-")));

after(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

const FIXTURE_FILES: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "summary-cache-fixture",
    type: "module",
    dependencies: { "used-dep": "1.0.0", "doc-dep": "1.0.0", "unused-dep": "1.0.0" },
  }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: { target: "es2022", module: "esnext", moduleResolution: "bundler" },
  }),
  "README.md": 'Usage:\n\n```ts\nimport { helper } from "doc-dep";\n```\n',
  "src/index.ts":
    'import "used-dep";\n' +
    'import { usedFunction } from "./used.js";\n' +
    'import { targetValue } from "./target";\n' +
    "export const entryValue = usedFunction() + targetValue;\n",
  "src/used.ts":
    "export const usedFunction = (): number => 1;\n" +
    "export const staleExport = (): number => 2;\n",
  "src/target/index.ts": "export const targetValue = 3;\n",
  "src/orphan.ts": "export const orphanValue = 4;\n",
};

interface FixtureWorkspace {
  readonly projectDirectory: string;
  readonly cachePath: string;
}

let fixtureCounter = 0;

const buildFixture = (extraFiles: Record<string, string> = {}): FixtureWorkspace => {
  fixtureCounter += 1;
  const workspaceDirectory = join(temporaryRoot, `case-${fixtureCounter}`);
  const projectDirectory = join(workspaceDirectory, "project");
  for (const [relativePath, contents] of Object.entries({ ...FIXTURE_FILES, ...extraFiles })) {
    const fullPath = join(projectDirectory, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, contents);
  }
  // The cache lives OUTSIDE the analyzed tree so its own writes don't churn
  // the tree fingerprint — mirroring react-doctor's node_modules/.cache home.
  return { projectDirectory, cachePath: join(workspaceDirectory, "cache", "summaries.json") };
};

const scan = async (
  workspace: FixtureWorkspace,
  options: { cached: boolean; overrides?: Partial<DeslopConfig> },
): Promise<ScanResult> =>
  analyze(
    defineConfig({
      rootDir: workspace.projectDirectory,
      ...(options.cached ? { incrementalCachePath: workspace.cachePath } : {}),
      ...options.overrides,
    }),
  );

// Cross-process scan for edits the in-process resolver content caches would
// hide (bundler-config content changes) — the dead-code worker's real model.
const scanInSubprocess = (
  workspace: FixtureWorkspace,
  options: { cached: boolean },
): ScanResult => {
  const runnerPath = join(import.meta.dirname, "helpers", "analyze-in-subprocess.ts");
  const stdout = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      runnerPath,
      JSON.stringify({
        rootDir: workspace.projectDirectory,
        ...(options.cached ? { incrementalCachePath: workspace.cachePath } : {}),
      }),
    ],
    { cwd: join(import.meta.dirname, ".."), encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
};

// Everything a consumer can observe from the graph analysis (plus the
// redundancy findings, to prove full-fidelity summary round-trips), normalized
// to a stable order with project-relative paths.
const resultSignature = (result: ScanResult, projectDirectory: string): string => {
  const relativePath = (filePath: string): string => relative(projectDirectory, filePath);
  return JSON.stringify({
    unusedFiles: result.unusedFiles.map((entry) => relativePath(entry.path)).sort(),
    unusedExports: result.unusedExports
      .map(
        (entry) =>
          `${relativePath(entry.path)}:${entry.line}:${entry.column}:${entry.name}` +
          `${entry.isTypeOnly ? ":type" : ""}`,
      )
      .sort(),
    unusedDependencies: result.unusedDependencies
      .map((entry) => `${entry.name}:${entry.isDevDependency ? "dev" : "prod"}`)
      .sort(),
    circularDependencies: result.circularDependencies
      .map((cycle) => cycle.files.map(relativePath).join(" -> "))
      .sort(),
    duplicateTypeDefinitions: result.duplicateTypeDefinitions
      .map((duplicate) =>
        duplicate.instances
          .map((instance) => `${relativePath(instance.path)}:${instance.typeName}`)
          .sort()
          .join(","),
      )
      .sort(),
    simplifiableExpressions: result.simplifiableExpressions
      .map((entry) => `${entry.kind}:${entry.snippet}`)
      .sort(),
    errorCodes: result.analysisErrors.map((analysisError) => analysisError.code).sort(),
  });
};

const unusedFileNames = (result: ScanResult, projectDirectory: string): string[] =>
  result.unusedFiles.map((entry) => relative(projectDirectory, entry.path)).sort();

const unusedExportNames = (result: ScanResult): string[] =>
  result.unusedExports.map((entry) => entry.name).sort();

const unusedDependencyNames = (result: ScanResult): string[] =>
  result.unusedDependencies.map((entry) => entry.name).sort();

describe("summary cache", () => {
  it("warm run over an unchanged tree matches the cold run and an uncached control", async () => {
    const workspace = buildFixture();
    const cold = await scan(workspace, { cached: true });
    assert.ok(existsSync(workspace.cachePath), "cold run should write the cache file");
    const warm = await scan(workspace, { cached: true });
    const control = await scan(workspace, { cached: false });

    const coldSignature = resultSignature(cold, workspace.projectDirectory);
    assert.equal(resultSignature(warm, workspace.projectDirectory), coldSignature);
    assert.equal(resultSignature(control, workspace.projectDirectory), coldSignature);

    // The fixture must exercise every consumed finding kind, or equality
    // between empty results would be a vacuous pass.
    assert.ok(unusedFileNames(cold, workspace.projectDirectory).includes("src/orphan.ts"));
    assert.ok(unusedExportNames(cold).includes("staleExport"));
    assert.deepEqual(unusedDependencyNames(cold), ["unused-dep"]);
  });

  it("skips the save when nothing changed", async () => {
    const workspace = buildFixture();
    await scan(workspace, { cached: true });
    const bytesAfterCold = readFileSync(workspace.cachePath, "utf-8");
    const mtimeAfterCold = statSync(workspace.cachePath).mtimeMs;
    await scan(workspace, { cached: true });
    assert.equal(readFileSync(workspace.cachePath, "utf-8"), bytesAfterCold);
    assert.equal(statSync(workspace.cachePath).mtimeMs, mtimeAfterCold);
  });

  it("reflects a single edited file and matches an uncached control", async () => {
    const workspace = buildFixture();
    const cold = await scan(workspace, { cached: true });
    assert.ok(!unusedExportNames(cold).includes("freshlyUnused"));

    const editedPath = join(workspace.projectDirectory, "src/used.ts");
    writeFileSync(
      editedPath,
      `${readFileSync(editedPath, "utf-8")}export const freshlyUnused = (): number => 5;\n`,
    );

    const warm = await scan(workspace, { cached: true });
    const control = await scan(workspace, { cached: false });
    assert.ok(unusedExportNames(warm).includes("freshlyUnused"));
    assert.equal(
      resultSignature(warm, workspace.projectDirectory),
      resultSignature(control, workspace.projectDirectory),
    );
  });

  it("re-resolves when an added file shadows an existing import target", async () => {
    const workspace = buildFixture();
    const cold = await scan(workspace, { cached: true });
    assert.ok(
      !unusedFileNames(cold, workspace.projectDirectory).includes("src/target/index.ts"),
      "before the shadow, ./target must resolve to target/index.ts",
    );

    // `./target` now resolves to the FILE, orphaning the directory index —
    // exactly the resolution flip a per-file resolved-path cache would miss.
    writeFileSync(
      join(workspace.projectDirectory, "src/target.ts"),
      "export const targetValue = 30;\n",
    );

    const warm = await scan(workspace, { cached: true });
    const control = await scan(workspace, { cached: false });
    assert.ok(unusedFileNames(warm, workspace.projectDirectory).includes("src/target/index.ts"));
    assert.equal(
      resultSignature(warm, workspace.projectDirectory),
      resultSignature(control, workspace.projectDirectory),
    );
  });

  it("reflects a deleted file and compacts its entries out of the store", async () => {
    const workspace = buildFixture();
    const cold = await scan(workspace, { cached: true });
    assert.ok(unusedFileNames(cold, workspace.projectDirectory).includes("src/orphan.ts"));

    const orphanPath = join(workspace.projectDirectory, "src/orphan.ts");
    unlinkSync(orphanPath);

    const warm = await scan(workspace, { cached: true });
    const control = await scan(workspace, { cached: false });
    assert.ok(!unusedFileNames(warm, workspace.projectDirectory).includes("src/orphan.ts"));
    assert.equal(
      resultSignature(warm, workspace.projectDirectory),
      resultSignature(control, workspace.projectDirectory),
    );

    const persisted = JSON.parse(readFileSync(workspace.cachePath, "utf-8"));
    const summaryPaths = Object.keys(persisted.summaries);
    assert.ok(summaryPaths.length > 0);
    assert.ok(
      summaryPaths.every((summaryPath) => !summaryPath.endsWith("orphan.ts")),
      "the deleted file's summary must be compacted away",
    );
  });

  it("reflects a manifest edit and matches an uncached control", async () => {
    const workspace = buildFixture();
    const cold = await scan(workspace, { cached: true });
    assert.deepEqual(unusedDependencyNames(cold), ["unused-dep"]);

    const manifestPath = join(workspace.projectDirectory, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.dependencies["second-unused-dep"] = "1.0.0";
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const warm = await scan(workspace, { cached: true });
    const control = await scan(workspace, { cached: false });
    assert.deepEqual(unusedDependencyNames(warm), ["second-unused-dep", "unused-dep"]);
    assert.equal(
      resultSignature(warm, workspace.projectDirectory),
      resultSignature(control, workspace.projectDirectory),
    );
  });

  it("drops the resolution map when a bundler alias config changes content", async () => {
    // The alias target is deliberately NOT "./"-relative so the config-string
    // entry heuristic ignores it — the dest files are reachable only through
    // MODULE RESOLUTION, isolating the resolution-map invalidation under test.
    const workspace = buildFixture({
      "src/index.ts":
        'import "used-dep";\n' +
        'import { usedFunction } from "./used.js";\n' +
        'import { targetValue } from "./target";\n' +
        'import { aliased } from "$dest";\n' +
        "export const entryValue = usedFunction() + targetValue + aliased;\n",
      "src/dest-a.ts": "export const aliased = 10;\n",
      "src/dest-b.ts": "export const aliased = 20;\n",
      "vite.config.ts": 'export default { resolve: { alias: { "$dest": "src/dest-a.ts" } } };\n',
    });
    // Subprocess scans: the resolver's in-process content caches would hide a
    // config-file content edit from repeat `analyze()` calls in one process
    // (pre-existing behavior, unrelated to the summary cache); the dead-code
    // worker spawns a fresh process per scan, which this mirrors.
    const cold = scanInSubprocess(workspace, { cached: true });
    assert.ok(unusedFileNames(cold, workspace.projectDirectory).includes("src/dest-b.ts"));
    assert.ok(!unusedFileNames(cold, workspace.projectDirectory).includes("src/dest-a.ts"));

    // Same file NAME set — only the alias TARGET changed, which only the
    // bundler-config content fingerprint can catch.
    writeFileSync(
      join(workspace.projectDirectory, "vite.config.ts"),
      'export default { resolve: { alias: { "$dest": "src/dest-b.ts" } } };\n',
    );

    const warm = scanInSubprocess(workspace, { cached: true });
    const control = scanInSubprocess(workspace, { cached: false });
    assert.ok(unusedFileNames(warm, workspace.projectDirectory).includes("src/dest-a.ts"));
    assert.ok(!unusedFileNames(warm, workspace.projectDirectory).includes("src/dest-b.ts"));
    assert.equal(
      resultSignature(warm, workspace.projectDirectory),
      resultSignature(control, workspace.projectDirectory),
    );
  });

  it("drops the resolution map when a tsconfig paths alias changes content", async () => {
    const workspace = buildFixture({
      "src/index.ts":
        'import "used-dep";\n' +
        'import { usedFunction } from "./used.js";\n' +
        'import { targetValue } from "./target";\n' +
        'import { aliased } from "@dest";\n' +
        "export const entryValue = usedFunction() + targetValue + aliased;\n",
      "src/dest-a.ts": "export const aliased = 10;\n",
      "src/dest-b.ts": "export const aliased = 20;\n",
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "es2022",
          module: "esnext",
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: { "@dest": ["./src/dest-a.ts"] },
        },
      }),
    });
    const cold = scanInSubprocess(workspace, { cached: true });
    assert.ok(unusedFileNames(cold, workspace.projectDirectory).includes("src/dest-b.ts"));
    assert.ok(!unusedFileNames(cold, workspace.projectDirectory).includes("src/dest-a.ts"));

    // tsconfig files are stat-fingerprinted manifest-like inputs: the edit
    // invalidates BOTH the collected-file-list key and the resolution map.
    writeFileSync(
      join(workspace.projectDirectory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "es2022",
          module: "esnext",
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: { "@dest": ["./src/dest-b.ts"] },
        },
      }),
    );

    const warm = scanInSubprocess(workspace, { cached: true });
    const control = scanInSubprocess(workspace, { cached: false });
    assert.ok(unusedFileNames(warm, workspace.projectDirectory).includes("src/dest-a.ts"));
    assert.ok(!unusedFileNames(warm, workspace.projectDirectory).includes("src/dest-b.ts"));
    assert.equal(
      resultSignature(warm, workspace.projectDirectory),
      resultSignature(control, workspace.projectDirectory),
    );
  });

  it("keeps entry resolution live: a config entry-string edit lands without invalidation", async () => {
    // `resolveEntries` reads config CONTENT (here vite.config.ts's "./"-
    // relative entry strings), which no name-based fingerprint can validate —
    // so entries must never be served from the cache.
    const workspace = buildFixture({
      "src/dest-a.ts": "export const standalone = 10;\n",
      "src/dest-b.ts": "export const standalone = 20;\n",
      "vite.config.ts": 'export default { build: { lib: { entry: "./src/dest-a.ts" } } };\n',
    });
    const cold = await scan(workspace, { cached: true });
    assert.ok(unusedFileNames(cold, workspace.projectDirectory).includes("src/dest-b.ts"));
    assert.ok(!unusedFileNames(cold, workspace.projectDirectory).includes("src/dest-a.ts"));

    writeFileSync(
      join(workspace.projectDirectory, "vite.config.ts"),
      'export default { build: { lib: { entry: "./src/dest-b.ts" } } };\n',
    );

    const warm = await scan(workspace, { cached: true });
    const control = await scan(workspace, { cached: false });
    assert.ok(unusedFileNames(warm, workspace.projectDirectory).includes("src/dest-a.ts"));
    assert.ok(!unusedFileNames(warm, workspace.projectDirectory).includes("src/dest-b.ts"));
    assert.equal(
      resultSignature(warm, workspace.projectDirectory),
      resultSignature(control, workspace.projectDirectory),
    );
  });

  it("fails open on a corrupt cache file and rewrites it", async () => {
    const workspace = buildFixture();
    mkdirSync(dirname(workspace.cachePath), { recursive: true });
    writeFileSync(workspace.cachePath, "{ this is not json");

    const corrupted = await scan(workspace, { cached: true });
    const control = await scan(workspace, { cached: false });
    assert.equal(
      resultSignature(corrupted, workspace.projectDirectory),
      resultSignature(control, workspace.projectDirectory),
    );
    const persisted = JSON.parse(readFileSync(workspace.cachePath, "utf-8"));
    assert.equal(persisted.version, SUMMARY_CACHE_SCHEMA_VERSION);
  });

  it("discards a schema-version-mismatched store instead of trusting its entries", async () => {
    const workspace = buildFixture();
    await scan(workspace, { cached: true });

    const persisted = JSON.parse(readFileSync(workspace.cachePath, "utf-8"));
    persisted.version = SUMMARY_CACHE_SCHEMA_VERSION + 999;
    // Poison every stored summary: if the version gate ever stops discarding,
    // the equivalence assertion below fails loudly.
    for (const summaryPath of Object.keys(persisted.summaries)) {
      persisted.summaries[summaryPath].p = { imports: "poisoned" };
    }
    writeFileSync(workspace.cachePath, JSON.stringify(persisted));

    const rebuilt = await scan(workspace, { cached: true });
    const control = await scan(workspace, { cached: false });
    assert.equal(
      resultSignature(rebuilt, workspace.projectDirectory),
      resultSignature(control, workspace.projectDirectory),
    );
    const rewritten = JSON.parse(readFileSync(workspace.cachePath, "utf-8"));
    assert.equal(rewritten.version, SUMMARY_CACHE_SCHEMA_VERSION);
  });

  it("treats a poisoned summary entry as a per-file miss", async () => {
    const workspace = buildFixture();
    await scan(workspace, { cached: true });

    const persisted = JSON.parse(readFileSync(workspace.cachePath, "utf-8"));
    const usedSummaryPath = Object.keys(persisted.summaries).find((summaryPath) =>
      summaryPath.endsWith("used.ts"),
    );
    assert.ok(usedSummaryPath);
    persisted.summaries[usedSummaryPath].p = { imports: "poisoned" };
    writeFileSync(workspace.cachePath, JSON.stringify(persisted));

    const warm = await scan(workspace, { cached: true });
    const control = await scan(workspace, { cached: false });
    assert.equal(
      resultSignature(warm, workspace.projectDirectory),
      resultSignature(control, workspace.projectDirectory),
    );
  });

  it("writes atomically, leaving no temp files behind", async () => {
    const workspace = buildFixture();
    await scan(workspace, { cached: true });
    const cacheDirectoryEntries = readdirSync(dirname(workspace.cachePath));
    assert.deepEqual(
      cacheDirectoryEntries.filter((entryName) => entryName.endsWith(".tmp")),
      [],
    );
  });

  it("documents the accepted blind spot: an mtime+size-preserving edit is invisible", async () => {
    // `blind.ts` must be REACHABLE (unused exports are only reported on
    // reachable modules), so the entry imports its `keep` export.
    const workspace = buildFixture({
      "src/blind.ts": "export const keep = 1;\nexport const aa = 1;\n",
      "src/index.ts":
        'import "used-dep";\n' +
        'import { usedFunction } from "./used.js";\n' +
        'import { targetValue } from "./target";\n' +
        'import { keep } from "./blind.js";\n' +
        "export const entryValue = usedFunction() + targetValue + keep;\n",
    });
    const pinnedTime = new Date(Date.now() - 60_000);
    const blindPath = join(workspace.projectDirectory, "src/blind.ts");
    utimesSync(blindPath, pinnedTime, pinnedTime);

    const cold = await scan(workspace, { cached: true });
    assert.ok(unusedExportNames(cold).includes("aa"));

    // Same byte length, same pinned mtime — the stat-based fingerprint cannot
    // see this edit (shared with core's whole-result and lint caches).
    writeFileSync(blindPath, "export const keep = 1;\nexport const ab = 1;\n");
    utimesSync(blindPath, pinnedTime, pinnedTime);

    const warm = await scan(workspace, { cached: true });
    assert.ok(unusedExportNames(warm).includes("aa"), "stale summary is served");
    assert.ok(!unusedExportNames(warm).includes("ab"));

    const control = await scan(workspace, { cached: false });
    assert.ok(unusedExportNames(control).includes("ab"), "an uncached run sees the edit");
  });

  it("round-trips redundancy findings at full fidelity, and slims them when disabled", async () => {
    const duplicateTypeFiles = {
      "src/shape-a.ts":
        "export interface Shape { id: string; name: string; size: number }\n" +
        "export const shapeA: Shape = { id: 'a', name: 'a', size: 1 };\n",
      "src/shape-b.ts":
        "export interface Shape { id: string; name: string; size: number }\n" +
        "export const shapeB: Shape = { id: 'b', name: 'b', size: 2 };\n",
      "src/index.ts":
        'import "used-dep";\n' +
        'import { usedFunction } from "./used.js";\n' +
        'import { targetValue } from "./target";\n' +
        'import { shapeA } from "./shape-a.js";\n' +
        'import { shapeB } from "./shape-b.js";\n' +
        "export const entryValue = usedFunction() + targetValue + shapeA.size + shapeB.size;\n",
    };

    const fullFidelity = buildFixture(duplicateTypeFiles);
    const cold = await scan(fullFidelity, { cached: true });
    assert.ok(
      cold.duplicateTypeDefinitions.some((duplicate) =>
        duplicate.instances.some((instance) => instance.typeName === "Shape"),
      ),
      "the fixture must produce a redundancy finding",
    );
    const warm = await scan(fullFidelity, { cached: true });
    const control = await scan(fullFidelity, { cached: false });
    assert.equal(
      resultSignature(warm, fullFidelity.projectDirectory),
      resultSignature(control, fullFidelity.projectDirectory),
    );
    assert.ok(readFileSync(fullFidelity.cachePath, "utf-8").includes('"typeDefinitionHashes"'));

    // react-doctor's worker config: the DRY-pattern consumers are off, so the
    // summaries must not pay for their fields.
    const slimOverrides: Partial<DeslopConfig> = {
      reportRedundancy: false,
      reportCodeQuality: false,
      semantic: { enabled: false } as DeslopConfig["semantic"],
    };
    const slimmed = buildFixture(duplicateTypeFiles);
    const slimCold = await scan(slimmed, { cached: true, overrides: slimOverrides });
    const slimWarm = await scan(slimmed, { cached: true, overrides: slimOverrides });
    const slimControl = await scan(slimmed, { cached: false, overrides: slimOverrides });
    assert.equal(
      resultSignature(slimWarm, slimmed.projectDirectory),
      resultSignature(slimControl, slimmed.projectDirectory),
    );
    assert.equal(
      resultSignature(slimCold, slimmed.projectDirectory),
      resultSignature(slimControl, slimmed.projectDirectory),
    );
    const slimmedCacheBytes = readFileSync(slimmed.cachePath, "utf-8");
    assert.ok(!slimmedCacheBytes.includes('"typeDefinitionHashes"'));
    assert.ok(!slimmedCacheBytes.includes('"simplifiableExpressions"'));
  });

  it("reports summary hit/miss stats only when the cache is active", async () => {
    const workspace = buildFixture();
    const collectedFileCount = 4;

    const control = await scan(workspace, { cached: false });
    assert.equal(control.incrementalCacheStats, undefined);

    const cold = await scan(workspace, { cached: true });
    assert.deepEqual(cold.incrementalCacheStats, {
      summaryHits: 0,
      summaryMisses: collectedFileCount,
    });

    const warm = await scan(workspace, { cached: true });
    assert.deepEqual(warm.incrementalCacheStats, {
      summaryHits: collectedFileCount,
      summaryMisses: 0,
    });

    const editedPath = join(workspace.projectDirectory, "src/used.ts");
    writeFileSync(editedPath, `${readFileSync(editedPath, "utf-8")}export const extra = 6;\n`);
    const oneTouched = await scan(workspace, { cached: true });
    assert.deepEqual(oneTouched.incrementalCacheStats, {
      summaryHits: collectedFileCount - 1,
      summaryMisses: 1,
    });
  });

  it("answers the stale-package glob queries from the walk byte-identically to fast-glob", async () => {
    const workspace = buildFixture({
      "packages/one/package.json": JSON.stringify({ name: "one" }),
      "packages/one/nested/two/three/package.json": JSON.stringify({ name: "too-deep-for-5" }),
      "dist/package.json": JSON.stringify({ name: "ignored-dist" }),
      ".hidden/package.json": JSON.stringify({ name: "dot-excluded" }),
      "docs/guide/deep/topics/more/usage.md": "# usage\n",
      "docs/.dot.md": "# dot file\n",
      "CHANGELOG.md": "# changes\n",
      ".storybook/main.ts": "export default {};\n",
      "tools/webpack.dev.config.js": "module.exports = {};\n",
      "apps/site/tsconfig.build.json": "{}\n",
      "linked-target/inner/package.json": JSON.stringify({ name: "via-symlink" }),
    });
    symlinkSync(
      join(workspace.projectDirectory, "linked-target"),
      join(workspace.projectDirectory, "linked"),
    );

    const cache = loadSummaryCache(
      defineConfig({
        rootDir: workspace.projectDirectory,
        incrementalCachePath: workspace.cachePath,
      }),
    );
    assert.ok(cache, "the cache must load for this fixture");

    const queries: Array<{
      patterns: string[];
      ignore: string[];
      deep: number;
      dot?: boolean;
    }> = [
      {
        patterns: ["**/package.json"],
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"],
        deep: 5,
      },
      {
        patterns: [".storybook/main.{js,ts,mjs,cjs}", "**/webpack*.config*.{js,ts,mjs,cjs}"],
        ignore: ["**/node_modules/**"],
        dot: true,
        deep: 3,
      },
      {
        patterns: ["**/*.{mdx,md}"],
        ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/CHANGELOG.md"],
        deep: 6,
      },
      {
        patterns: ["tsconfig.json", "tsconfig.*.json", "**/tsconfig.json", "**/tsconfig.*.json"],
        ignore: ["**/node_modules/**"],
        dot: false,
        deep: 4,
      },
    ];
    const fg = (await import("fast-glob")).default;
    for (const query of queries) {
      const walked = cache.matchWalkedFiles({ cwd: workspace.projectDirectory, ...query });
      assert.ok(walked, "the walk root matches, so the query must be answerable");
      const globbed = fg
        .sync(query.patterns, {
          cwd: workspace.projectDirectory,
          absolute: true,
          onlyFiles: true,
          ignore: query.ignore,
          deep: query.deep,
          ...(query.dot === undefined ? {} : { dot: query.dot }),
        })
        .sort();
      assert.deepEqual(walked, globbed, JSON.stringify(query.patterns));
    }
    assert.ok(
      cache
        .matchWalkedFiles({
          cwd: workspace.projectDirectory,
          patterns: ["**/package.json"],
          ignore: [],
          deep: 5,
        })
        ?.some((matchedPath) => matchedPath.endsWith("linked/inner/package.json")),
      "symlinked directories are followed, matching fast-glob",
    );

    // A search root other than the walk root (the monorepo-root case) is not
    // answerable from this walk — callers fall back to a real glob scan.
    assert.equal(
      cache.matchWalkedFiles({
        cwd: dirname(workspace.projectDirectory),
        patterns: ["**/package.json"],
        ignore: [],
        deep: 5,
      }),
      null,
    );
  });
});
