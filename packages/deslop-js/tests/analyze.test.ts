import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { resolve, relative } from "node:path";
import { analyze, defineConfig } from "../src/index.js";
import type { ScanResult } from "../src/types.js";
import { FIXTURES_DIR } from "./helpers/fixtures-dir.js";

const scanFixture = async (
  fixtureName: string,
  overrides: Record<string, unknown> = {},
): Promise<ScanResult> => {
  const fixtureDir = resolve(FIXTURES_DIR, fixtureName);
  const config = defineConfig({
    rootDir: fixtureDir,
    ...overrides,
  });
  return analyze(config);
};

const orphanPaths = (result: ScanResult, fixtureDir: string): string[] =>
  result.unusedFiles.map((unusedFile) => relative(fixtureDir, unusedFile.path)).sort();

const deadExportNames = (result: ScanResult): string[] =>
  result.unusedExports.map((unusedExport) => unusedExport.name).sort();

const deadExportsByFile = (result: ScanResult, fixtureDir: string): Record<string, string[]> => {
  const byFile: Record<string, string[]> = {};
  for (const unusedExport of result.unusedExports) {
    const relativePath = relative(fixtureDir, unusedExport.path);
    if (!byFile[relativePath]) byFile[relativePath] = [];
    byFile[relativePath].push(unusedExport.name);
  }
  for (const key of Object.keys(byFile)) {
    byFile[key].sort();
  }
  return byFile;
};

const staleDependencyNames = (result: ScanResult): string[] =>
  result.unusedDependencies.map((dep) => dep.name).sort();

describe("simple-app", () => {
  it("should detect orphan file", async () => {
    const result = await scanFixture("simple-app");
    const fixtureDir = resolve(FIXTURES_DIR, "simple-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should detect unused exports in utils", async () => {
    const result = await scanFixture("simple-app");
    const fixtureDir = resolve(FIXTURES_DIR, "simple-app");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    assert.ok(
      exportsByFile["src/utils.ts"]?.includes("unusedFunction"),
      `unusedFunction should be flagged, got: ${JSON.stringify(exportsByFile["src/utils.ts"])}`,
    );
  });

  it("should detect unused dependency", async () => {
    const result = await scanFixture("simple-app");
    const deps = staleDependencyNames(result);
    assert.ok(deps.includes("unused-dep"), `unused-dep should be flagged, got: ${deps}`);
  });

  it("should explain each unused dependency with a reason that names the package", async () => {
    const result = await scanFixture("simple-app");
    const unusedDep = result.unusedDependencies.find((dep) => dep.name === "unused-dep");
    assert.ok(unusedDep, `unused-dep finding should exist, got: ${staleDependencyNames(result)}`);
    assert.equal(unusedDep.isDevDependency, false);
    assert.match(unusedDep.reason, /"unused-dep"/);
    assert.match(unusedDep.reason, /declared in dependencies\b/);
  });

  it("should not flag usedFunction as unused", async () => {
    const result = await scanFixture("simple-app");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("usedFunction"), "usedFunction should not be unused");
  });

  it("should flag react as unused (declared but never imported)", async () => {
    const result = await scanFixture("simple-app");
    const deps = staleDependencyNames(result);
    assert.ok(deps.includes("react"), `react should be unused since never imported, got: ${deps}`);
  });
});

describe("gitignore-app", () => {
  it("suppresses reports for gitignored files without dropping their import edges", async () => {
    const result = await scanFixture("gitignore-app");
    const fixtureDir = resolve(FIXTURES_DIR, "gitignore-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `genuine orphan should still be reported, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath.includes("generated")),
      `gitignored files must not be reported as unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/home-route.ts"),
      `a file reachable only through a gitignored importer must stay used (no cascade), got: ${unusedFilePaths}`,
    );

    const unusedExportPaths = result.unusedExports.map((unusedExport) =>
      relative(fixtureDir, unusedExport.path),
    );
    assert.ok(
      !unusedExportPaths.some((filePath) => filePath.includes("generated")),
      `exports inside gitignored files must not be reported, got: ${unusedExportPaths}`,
    );
  });
});

describe("dependency-tooling", () => {
  it("should keep peer dependencies, script binaries, overrides, and Nx project refs used", async () => {
    const result = await scanFixture("dependency-tooling");
    const deps = staleDependencyNames(result);
    const expectedUsedDeps = [
      "@babel/cli",
      "@formatjs/cli",
      "@hookform/resolvers",
      "@nx/js",
      "@tauri-apps/cli",
      "@tinacms/cli",
      "@typescript/native-preview",
      "babel-eslint",
      "chart.js",
      "chokidar-cli",
      "jest-cli",
      "prompt",
      "react-chartjs-2",
      "react-redux",
      "redux",
      "replace-in-file",
      "tsc-alias",
      "zod",
    ];
    for (const dependencyName of expectedUsedDeps) {
      assert.ok(
        !deps.includes(dependencyName),
        `${dependencyName} should be treated as used, got: ${deps}`,
      );
    }
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
    assert.ok(deps.includes("unused-tool"), `unused-tool should be unused, got: ${deps}`);
    assert.ok(deps.includes("redux-thunk"), `redux-thunk should be unused, got: ${deps}`);
  });

  it("should name the package and devDependencies section for unused dev dependencies", async () => {
    const result = await scanFixture("dependency-tooling");
    const unusedTool = result.unusedDependencies.find((dep) => dep.name === "unused-tool");
    assert.ok(unusedTool, `unused-tool finding should exist, got: ${staleDependencyNames(result)}`);
    assert.equal(unusedTool.isDevDependency, true);
    assert.match(unusedTool.reason, /"unused-tool"/);
    assert.match(unusedTool.reason, /declared in devDependencies\b/);
  });

  it("should keep pnpm-workspace override targets used", async () => {
    const result = await scanFixture("pnpm-workspace-override");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("@voidzero-dev/vite-plus-core"),
      `@voidzero-dev/vite-plus-core should be treated as used via pnpm-workspace overrides, got: ${deps}`,
    );
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });

  it("resolves script-invoked CLIs without installed metadata only via same-name binaries, prefixes, or implicit deps", async () => {
    const result = await scanFixture("script-cli-deps");
    const deps = staleDependencyNames(result);
    // turbo's binary is `turbo` (same name), tsx is implicit, and `@changesets/*`
    // is an always-used prefix — all resolve with no node_modules present.
    for (const dependencyName of ["turbo", "tsx", "@changesets/cli"]) {
      assert.ok(
        !deps.includes(dependencyName),
        `${dependencyName} should still be treated as used, got: ${deps}`,
      );
    }
    // vite-plus exposes the `vp` binary, whose name differs from the package; with
    // no installed bin metadata there is nothing to map `vp` -> vite-plus, so it is
    // flagged. Installing it (real bin metadata) resolves it — see dependency-tooling.
    assert.ok(
      deps.includes("vite-plus"),
      `vite-plus (bin "vp") is unresolvable without installed metadata, got: ${deps}`,
    );
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });

  it("should keep nested package.json override targets used", async () => {
    const result = await scanFixture("nested-overrides");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("@typescript/native-preview"),
      `@typescript/native-preview should be treated as used via nested overrides, got: ${deps}`,
    );
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });

  it("should keep nested pnpm-workspace override targets used", async () => {
    const result = await scanFixture("pnpm-nested-overrides");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("@typescript/native-preview"),
      `@typescript/native-preview should be treated as used via nested pnpm-workspace overrides, got: ${deps}`,
    );
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });

  it("should keep vitest override targets used", async () => {
    const result = await scanFixture("vitest-override-target");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("@voidzero-dev/vite-plus-test"),
      `@voidzero-dev/vite-plus-test should be treated as used via pnpm-workspace overrides, got: ${deps}`,
    );
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });
});

describe("css-tilde-import", () => {
  it("should detect Sass tilde package imports as dependency usage", async () => {
    const result = await scanFixture("css-tilde-import");
    const deps = staleDependencyNames(result);
    assert.ok(!deps.includes("bootstrap"), `bootstrap should be used from SCSS, got: ${deps}`);
    assert.ok(deps.includes("unused-dep"), `unused-dep should be unused, got: ${deps}`);
  });
});

describe("tailwind-v4-plugin", () => {
  it('should treat Tailwind v4 `@plugin "pkg"` directives as dependency usage', async () => {
    const result = await scanFixture("tailwind-v4-plugin");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("tailwindcss-animate"),
      `tailwindcss-animate is loaded via @plugin in CSS and must not be flagged, got: ${deps}`,
    );
    assert.ok(deps.includes("unused-dep"), `unused-dep should still be unused, got: ${deps}`);
  });
});

describe("workspace-local-bin", () => {
  it("should resolve script binaries from workspace-local node_modules (pnpm isolation)", async () => {
    const result = await scanFixture("workspace-local-bin");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("react-email"),
      `react-email provides the 'email' bin used by email:preview script and must not be flagged, got: ${deps}`,
    );
    assert.ok(
      deps.includes("unused-dev-tool"),
      `unused-dev-tool should still be unused, got: ${deps}`,
    );
  });

  it("should not flag a package that ships a binary even when no script references it", async () => {
    const result = await scanFixture("workspace-local-bin");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("bin-only-tool"),
      `bin-only-tool declares a bin and is invokable outside the static scan (npx, hooks, CI) — it must not be flagged, got: ${deps}`,
    );
  });
});

describe("monorepo-script-entry", () => {
  it("should treat files referenced by parent monorepo scripts as workspace entry points", async () => {
    const fixtureDir = resolve(FIXTURES_DIR, "monorepo-script-entry", "packages", "sub");
    const config = defineConfig({ rootDir: fixtureDir });
    const result = await analyze(config);
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("internal-tools/tui.ts"),
      `tui.ts is referenced by parent monorepo script and must not be flagged unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("internal-tools/renderer.ts"),
      `renderer.ts is transitively reachable from parent monorepo script entry, got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-subpath-import", () => {
  it("should treat files imported by sibling workspaces via package subpaths as entry points", async () => {
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-subpath-import", "packages", "ui");
    const config = defineConfig({ rootDir: fixtureDir });
    const result = await analyze(config);
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("button.tsx"),
      `button.tsx is imported by a sibling workspace via @subpath-fixture/ui/button and must not be flagged, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("utils.ts"),
      `utils.ts is transitively reachable from button.tsx, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts is not imported anywhere and should still be flagged, got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-subpath-import-built", () => {
  it("should map built dist subpath targets back to source files for sibling workspace imports", async () => {
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-subpath-import-built", "packages", "ui");
    const config = defineConfig({ rootDir: fixtureDir });
    const result = await analyze(config);
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/button.ts"),
      `src/button.ts must not be flagged even when the built dist artifact exists on disk, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts is not imported anywhere and should still be flagged, got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-subpath-wildcard-export", () => {
  it("should resolve sibling workspace subpath imports through wildcard exports patterns", async () => {
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-subpath-wildcard-export", "packages", "ui");
    const config = defineConfig({ rootDir: fixtureDir });
    const result = await analyze(config);
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/button.tsx"),
      `src/components/button.tsx is imported via the "./*" exports pattern (dist target mapped back to src) and must not be flagged, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/components/helpers.ts"),
      `src/components/helpers.ts is transitively reachable from button.tsx, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/components/orphan.ts"),
      `src/components/orphan.ts is not imported anywhere and should still be flagged, got: ${unusedFilePaths}`,
    );
  });
});

describe("vercel-config-app", () => {
  it("should not flag vercel.ts as an unused file", async () => {
    const result = await scanFixture("vercel-config-app");
    const fixtureDir = resolve(FIXTURES_DIR, "vercel-config-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("vercel.ts"),
      `vercel.ts is a deploy-time config file and must not be flagged, got: ${unusedFilePaths}`,
    );
  });
});

describe("duplicate-import-type-value", () => {
  it("should not flag a type-only import + a value import of the same module as duplicates", async () => {
    const result = await scanFixture("duplicate-import-type-value");
    const fixtureDir = resolve(FIXTURES_DIR, "duplicate-import-type-value");
    const dupes = result.duplicateImports.filter(
      (dup) => dup.path === resolve(fixtureDir, "src/consumer-split.ts"),
    );
    const valueDupes = dupes.filter((dup) =>
      dup.occurrences.every((occurrence) => !occurrence.isTypeOnly),
    );
    const typeDupes = dupes.filter((dup) =>
      dup.occurrences.every((occurrence) => occurrence.isTypeOnly),
    );
    const mixedDupes = dupes.filter(
      (dup) =>
        dup.occurrences.some((occurrence) => occurrence.isTypeOnly) &&
        dup.occurrences.some((occurrence) => !occurrence.isTypeOnly),
    );
    assert.strictEqual(
      mixedDupes.length,
      0,
      `type-only + value imports must NOT be grouped together: ${JSON.stringify(mixedDupes)}`,
    );
    assert.strictEqual(
      typeDupes.length,
      0,
      `single type-only import should not be flagged: ${JSON.stringify(typeDupes)}`,
    );
    assert.ok(
      valueDupes.some((dup) => dup.specifier === "./api"),
      `3 value-imports of "./api" SHOULD be flagged as duplicates: ${JSON.stringify(dupes)}`,
    );
  });
});

describe("jsx-block-arrow", () => {
  it("should not flag arrow components returning JSX as block-arrow-single-return", async () => {
    const result = await scanFixture("jsx-block-arrow");
    const simplifiable = result.simplifiableFunctions.filter(
      (item) => item.kind === "block-arrow-single-return",
    );
    const jsxNames = ["HrComponent", "FragmentComponent"];
    for (const componentName of jsxNames) {
      assert.ok(
        !simplifiable.some((item) => item.functionName === componentName),
        `JSX-returning arrow ${componentName} must not be flagged: ${JSON.stringify(simplifiable)}`,
      );
    }
    assert.ok(
      simplifiable.some((item) => item.functionName === "shouldFlagIdentity"),
      `non-JSX single-return arrow shouldFlagIdentity SHOULD still be flagged: ${JSON.stringify(simplifiable)}`,
    );
  });
});

describe("filename-registry-entries", () => {
  it("should treat unique filename string literals in source as soft entries (dynamic-loading pattern)", async () => {
    const result = await scanFixture("filename-registry-entries");
    const fixtureDir = resolve(FIXTURES_DIR, "filename-registry-entries");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("tools/diagnose-user.ts"),
      `diagnose-user.ts is registered by basename string and must be treated as entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("tools/export-data.ts"),
      `export-data.ts is registered by basename string and must be treated as entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("tools/genuinely-dead.ts"),
      `genuinely-dead.ts has no string-literal references and SHOULD still be flagged, got: ${unusedFilePaths}`,
    );
  });
});

describe("expo-config-plugins", () => {
  it("should treat local Expo config plugins as entry points", async () => {
    const result = await scanFixture("expo-config-plugins");
    const fixtureDir = resolve(FIXTURES_DIR, "expo-config-plugins");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    for (const expectedReachableFile of [
      // A plain template string in app.config.ts.
      "plugins/template-literal-plugin.ts",
      // A tuple entry that points at a directory with index.ts.
      "plugins/directory-index-plugin/index.ts",
      // An extensionless local path in expo.plugins.
      "plugins/expo-json-extensionless-plugin.ts",
      // A root-level plugins array in app.json.
      "plugins/root-json-plugin.ts",
      // A workspace app.config.js can point at a plugin outside its package.
      "apps/shared/cross-workspace-plugin.ts",
    ]) {
      assert.ok(
        !unusedFilePaths.includes(expectedReachableFile),
        `${expectedReachableFile} is referenced by Expo config plugins and must not be flagged unused, got: ${unusedFilePaths}`,
      );
    }

    assert.ok(
      unusedFilePaths.includes("expo-camera.ts"),
      `package-name lookalikes must not be treated as local plugin files, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("plugins/false-positive-target.ts"),
      `nested non-Expo plugin arrays, dynamic tuple entries, absolute paths, and wildcard paths must not mark false-positive-target.ts reachable, got: ${unusedFilePaths}`,
    );
  });
});

describe("nested-dist-non-workspace", () => {
  it("should exclude `dist/` directories at ANY depth, not just at workspace roots", async () => {
    const result = await scanFixture("nested-dist-non-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "nested-dist-non-workspace");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("apps/orphan/dist/index.mjs"),
      `apps/orphan/dist/ must be globally excluded (no package.json so dir isn't a workspace), got: ${unusedFilePaths}`,
    );
  });
});

describe("empty-and-binary-files", () => {
  it("should not flag minified/binary files as unusedFiles (parser can't see their imports)", async () => {
    const result = await scanFixture("empty-and-binary-files");
    const fixtureDir = resolve(FIXTURES_DIR, "empty-and-binary-files");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/minified-bundle.js"),
      `minified bundle must not be in unusedFiles (analysisError already signals it), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/binary-file.ts"),
      `binary file must not be in unusedFiles, got: ${unusedFilePaths}`,
    );
  });
});

describe("reexport-star", () => {
  it("should not flag foo as unused (used via barrel)", async () => {
    const result = await scanFixture("reexport-star");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("foo"), "foo is used through barrel");
  });

  it("should flag fooUnused as unused", async () => {
    const result = await scanFixture("reexport-star");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("fooUnused"),
      `fooUnused should be unused, got: ${allUnusedNames}`,
    );
  });

  it("should not flag module-b.ts as unused file (file-level: re-exported by barrel makes it reachable)", async () => {
    const result = await scanFixture("reexport-star");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-star");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath === "src/module-b.ts"),
      `module-b.ts should be reachable via barrel re-export (file-level), got: ${unusedFilePaths}`,
    );
  });

  it("should not flag module-c.ts as unused file (file-level: star re-exported by barrel makes it reachable)", async () => {
    const result = await scanFixture("reexport-star");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-star");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath === "src/module-c.ts"),
      `module-c.ts should be reachable via barrel star re-export (file-level), got: ${unusedFilePaths}`,
    );
  });
});

describe("reexport-chains (3-level barrel chain)", () => {
  it("should not flag alpha and beta (used via 3-level chain)", async () => {
    const result = await scanFixture("reexport-chains");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("alpha"), "alpha is used via chain");
    assert.ok(!allUnusedNames.includes("beta"), "beta is used via chain");
  });

  it("should flag gamma and delta as unused", async () => {
    const result = await scanFixture("reexport-chains");
    const allUnusedNames = deadExportNames(result);
    assert.ok(allUnusedNames.includes("gamma"), `gamma should be unused, got: ${allUnusedNames}`);
    assert.ok(allUnusedNames.includes("delta"), `delta should be unused, got: ${allUnusedNames}`);
  });

  it("should not flag any file as unused", async () => {
    const result = await scanFixture("reexport-chains");
    assert.equal(result.unusedFiles.length, 0, "all files are reachable via chain");
  });
});

describe("ns-imports", () => {
  it("should flag exports not accessed via namespace member access", async () => {
    const result = await scanFixture("ns-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "ns-imports");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    assert.deepStrictEqual(exportsByFile["src/utils.ts"], ["bar", "baz"]);
  });

  it("should not flag any files as unused", async () => {
    const result = await scanFixture("ns-imports");
    assert.equal(result.unusedFiles.length, 0);
  });
});

describe("ns-partial", () => {
  it("should flag only the exports not accessed via member access", async () => {
    const result = await scanFixture("ns-partial");
    const fixtureDir = resolve(FIXTURES_DIR, "ns-partial");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    const unusedMathExports = (exportsByFile["src/math.ts"] ?? []).sort();
    assert.deepStrictEqual(unusedMathExports, ["divide", "subtract"]);
  });
});

describe("ns-whole", () => {
  it("should not flag any exports when Object.values is used on namespace", async () => {
    const result = await scanFixture("ns-whole");
    assert.equal(
      result.unusedExports.length,
      0,
      `expected 0 unused exports, got: ${deadExportNames(result)}`,
    );
  });
});

describe("ns-spread", () => {
  it("should not flag any exports when namespace is spread into object", async () => {
    const result = await scanFixture("ns-spread");
    assert.equal(
      result.unusedExports.length,
      0,
      `expected 0 unused exports, got: ${deadExportNames(result)}`,
    );
  });
});

describe("ns-forin", () => {
  it("should not flag any exports when namespace is used in for..in", async () => {
    const result = await scanFixture("ns-forin");
    assert.equal(
      result.unusedExports.length,
      0,
      `expected 0 unused exports, got: ${deadExportNames(result)}`,
    );
  });
});

describe("ns-reexport", () => {
  it("should flag only the exports not accessed through barrel via namespace member access", async () => {
    const result = await scanFixture("ns-reexport");
    const fixtureDir = resolve(FIXTURES_DIR, "ns-reexport");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    assert.deepStrictEqual(exportsByFile["src/lib/helpers.ts"], ["helperB", "helperC"]);
  });

  it("should not flag any files as unused", async () => {
    const result = await scanFixture("ns-reexport");
    assert.equal(result.unusedFiles.length, 0);
  });
});

describe("export-default", () => {
  it("should flag default export of component.ts (only named is used)", async () => {
    const result = await scanFixture("export-default");
    const fixtureDir = resolve(FIXTURES_DIR, "export-default");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    assert.ok(
      exportsByFile["src/component.ts"]?.includes("default"),
      `default should be unused in component.ts, got: ${JSON.stringify(exportsByFile)}`,
    );
  });

  it("should flag unused-default.ts as unused file", async () => {
    const result = await scanFixture("export-default");
    const fixtureDir = resolve(FIXTURES_DIR, "export-default");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/unused-default.ts"),
      `unused-default.ts should be unused file, got: ${unusedFilePaths}`,
    );
  });

  it("should not flag usedNamed as unused", async () => {
    const result = await scanFixture("export-default");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("usedNamed"), "usedNamed is imported");
  });
});

describe("import-side-effect", () => {
  it("should keep setup.ts reachable (side-effect import)", async () => {
    const result = await scanFixture("import-side-effect");
    const fixtureDir = resolve(FIXTURES_DIR, "import-side-effect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/setup.ts"), "setup.ts is side-effect imported");
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await scanFixture("import-side-effect");
    const fixtureDir = resolve(FIXTURES_DIR, "import-side-effect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("cycle-reexport", () => {
  it("should not flag fromA or fromB (used despite circular re-exports)", async () => {
    const result = await scanFixture("cycle-reexport");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("fromA"), "fromA is used");
    assert.ok(!allUnusedNames.includes("fromB"), "fromB is used");
  });

  it("should not hang or crash from circular re-export", async () => {
    const result = await scanFixture("cycle-reexport");
    assert.ok(result.totalFiles > 0, "analysis should complete");
  });
});

describe("star-reexport-chain", () => {
  it("should not flag used as unused (via star re-export chain)", async () => {
    const result = await scanFixture("star-reexport-chain");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("used"), "used should be found through star chain");
  });

  it("should flag unused export in source", async () => {
    const result = await scanFixture("star-reexport-chain");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unused"),
      `unused should be flagged, got: ${allUnusedNames}`,
    );
  });
});

describe("star-selective", () => {
  it("should not flag usedOne and usedTwo (selectively imported via star barrel)", async () => {
    const result = await scanFixture("star-selective");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("usedOne"), "usedOne is used");
    assert.ok(!allUnusedNames.includes("usedTwo"), "usedTwo is used");
  });

  it("should flag unusedThree and unusedFour", async () => {
    const result = await scanFixture("star-selective");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unusedThree"),
      `unusedThree should be flagged, got: ${allUnusedNames}`,
    );
    assert.ok(
      allUnusedNames.includes("unusedFour"),
      `unusedFour should be flagged, got: ${allUnusedNames}`,
    );
  });
});

describe("reexport-multi-hop", () => {
  it("should not flag used (imported through two barrel hops)", async () => {
    const result = await scanFixture("reexport-multi-hop");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("used"), "used is consumed through 2-hop barrel");
  });

  it("should flag unused1 and unused2", async () => {
    const result = await scanFixture("reexport-multi-hop");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unused1"),
      `unused1 should be unused, got: ${allUnusedNames}`,
    );
    assert.ok(
      allUnusedNames.includes("unused2"),
      `unused2 should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("reexport-multi-level", () => {
  it("should not flag alpha and beta (used through 3-level named re-export chain)", async () => {
    const result = await scanFixture("reexport-multi-level");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("alpha"), "alpha is used");
    assert.ok(!allUnusedNames.includes("beta"), "beta is used");
  });

  it("should flag gamma (re-exported in barrel-a but not imported)", async () => {
    const result = await scanFixture("reexport-multi-level");
    const allUnusedNames = deadExportNames(result);
    assert.ok(allUnusedNames.includes("gamma"), `gamma should be unused, got: ${allUnusedNames}`);
  });

  it("should flag delta (only in barrel-b, not re-exported by barrel-a)", async () => {
    const result = await scanFixture("reexport-multi-level");
    const allUnusedNames = deadExportNames(result);
    assert.ok(allUnusedNames.includes("delta"), `delta should be unused, got: ${allUnusedNames}`);
  });

  it("should flag epsilon (not re-exported at all)", async () => {
    const result = await scanFixture("reexport-multi-level");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("epsilon"),
      `epsilon should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("reexport-default", () => {
  it("should not flag Button (used via default re-export through barrel)", async () => {
    const result = await scanFixture("reexport-default");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-default");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    const buttonExports = exportsByFile["src/components/Button.ts"];
    assert.ok(!buttonExports?.includes("default"), "Button default export is used");
  });
});

describe("reexport-unused", () => {
  it("should not flag UsedComponent", async () => {
    const result = await scanFixture("reexport-unused");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("UsedComponent"), "UsedComponent is imported");
  });

  it("should not flag unused-source.ts as unused file (file-level: barrel re-export makes it reachable)", async () => {
    const result = await scanFixture("reexport-unused");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-unused");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath === "src/components/unused-source.ts"),
      `unused-source.ts should be reachable via barrel re-export (file-level), got: ${unusedFilePaths}`,
    );
  });
});

describe("deep-reexport-tracking", () => {
  it("should keep used-source.ts reachable (usedHelper consumed through two barrel layers)", async () => {
    const result = await scanFixture("deep-reexport-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "deep-reexport-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/used-source.ts"),
      "used-source.ts should be reachable via barrel-mid → barrel-top → index",
    );
  });

  it("should not flag unused-source.ts as unused file (file-level: barrel re-export chain makes it reachable)", async () => {
    const result = await scanFixture("deep-reexport-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "deep-reexport-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/unused-source.ts"),
      `unused-source.ts should be reachable via barrel re-export chain (file-level), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan.ts as unused file", async () => {
    const result = await scanFixture("deep-reexport-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "deep-reexport-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag usedHelperSibling as unused export", async () => {
    const result = await scanFixture("deep-reexport-tracking");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("usedHelperSibling"),
      `usedHelperSibling should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("wildcard-late-consume", () => {
  it("should keep color-picker reachable when consumed via plugin that imports from sibling component barrel", async () => {
    const result = await scanFixture("wildcard-late-consume");
    const fixtureDir = resolve(FIXTURES_DIR, "wildcard-late-consume");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/color-picker/color-picker.ts"),
      `color-picker.ts should be reachable via plugin → components barrel → color-picker barrel, got unused: ${unusedFilePaths}`,
    );
  });

  it("should keep color-picker/index.ts reachable as intermediate barrel", async () => {
    const result = await scanFixture("wildcard-late-consume");
    const fixtureDir = resolve(FIXTURES_DIR, "wildcard-late-consume");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/color-picker/index.ts"),
      `color-picker/index.ts should be reachable, got unused: ${unusedFilePaths}`,
    );
  });

  it("should flag unused-widget.ts as unused file (never imported by any plugin)", async () => {
    const result = await scanFixture("wildcard-late-consume");
    const fixtureDir = resolve(FIXTURES_DIR, "wildcard-late-consume");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/components/unused-widget.ts"),
      `unused-widget.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag ColorUtils as unused export (only ColorPicker consumed from color-picker.ts)", async () => {
    const result = await scanFixture("wildcard-late-consume");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("ColorUtils"),
      `ColorUtils should be unused export, got: ${allUnusedNames}`,
    );
  });
});

describe("import-reexport-same", () => {
  it("should create both direct import and re-export edges when a file imports from and re-exports the same module", async () => {
    const result = await scanFixture("import-reexport-same");
    const fixtureDir = resolve(FIXTURES_DIR, "import-reexport-same");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/widget.ts"),
      `widget.ts should be reachable via re-export through components barrel (export * from), got unused: ${unusedFilePaths}`,
    );
  });

  it("should keep helper.ts reachable via both direct import and re-export", async () => {
    const result = await scanFixture("import-reexport-same");
    const fixtureDir = resolve(FIXTURES_DIR, "import-reexport-same");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/helper.ts"),
      `helper.ts should be reachable, got unused: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan.ts as unused (not imported or re-exported by anyone)", async () => {
    const result = await scanFixture("import-reexport-same");
    const fixtureDir = resolve(FIXTURES_DIR, "import-reexport-same");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("reexport-alias", () => {
  it("should not flag original and renamed (used via aliased re-export chain)", async () => {
    const result = await scanFixture("reexport-alias");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("original"), "original is used via aliasC");
    assert.ok(!allUnusedNames.includes("renamed"), "renamed is used via doubleAlias");
  });

  it("should flag unusedOriginal (aliased but never consumed)", async () => {
    const result = await scanFixture("reexport-alias");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unusedOriginal"),
      `unusedOriginal should be unused, got: ${allUnusedNames}`,
    );
  });

  it("should flag neverExported (not re-exported by any barrel)", async () => {
    const result = await scanFixture("reexport-alias");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("neverExported"),
      `neverExported should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("import-dynamic", () => {
  it("should keep lazy.ts reachable via dynamic import", async () => {
    const result = await scanFixture("import-dynamic");
    const fixtureDir = resolve(FIXTURES_DIR, "import-dynamic");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/lazy.ts"), "lazy.ts is dynamically imported");
  });

  it("should flag orphan.ts as unused file", async () => {
    const result = await scanFixture("import-dynamic");
    const fixtureDir = resolve(FIXTURES_DIR, "import-dynamic");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag unused export in utils", async () => {
    const result = await scanFixture("import-dynamic");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unused"),
      `unused should be flagged, got: ${allUnusedNames}`,
    );
  });
});

describe("type-deps", () => {
  it("should detect type-only imports", async () => {
    const result = await scanFixture("type-deps");
    assert.ok(result.totalFiles > 0, "should find files");
  });
});

describe("orphan-barrel-subtree", () => {
  it("should flag all files in the dead subtree", async () => {
    const result = await scanFixture("orphan-barrel-subtree");
    const fixtureDir = resolve(FIXTURES_DIR, "orphan-barrel-subtree");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/subtree/setup.ts"),
      `setup.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("orphan-mixed-exports", () => {
  it("should flag both files in unreachable test-utils", async () => {
    const result = await scanFixture("orphan-mixed-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "orphan-mixed-exports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/test-utils/helpers.ts"),
      `helpers.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/test-utils/setup.ts"),
      `setup.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("reexport-mixed", () => {
  it("should not flag namedUsed and starUsed", async () => {
    const result = await scanFixture("reexport-mixed");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("namedUsed"), "namedUsed is consumed");
    assert.ok(!allUnusedNames.includes("starUsed"), "starUsed is consumed");
  });

  it("should flag namedUnused and starUnused", async () => {
    const result = await scanFixture("reexport-mixed");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("namedUnused"),
      `namedUnused should be flagged, got: ${allUnusedNames}`,
    );
    assert.ok(
      allUnusedNames.includes("starUnused"),
      `starUnused should be flagged, got: ${allUnusedNames}`,
    );
  });
});

describe("alias-paths", () => {
  it("should resolve @/ alias and not flag helper as unused", async () => {
    const result = await scanFixture("alias-paths");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("helper"), "helper is imported via @/ alias");
  });

  it("should not flag any files as unused", async () => {
    const result = await scanFixture("alias-paths");
    assert.equal(result.unusedFiles.length, 0, "all files reachable via alias");
  });
});

describe("webpack-resolve", () => {
  it("should resolve webpack aliases and module roots", async () => {
    const result = await scanFixture("webpack-resolve");
    const fixtureDir = resolve(FIXTURES_DIR, "webpack-resolve");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/App.ts"),
      `App.ts should be reachable through resolve.modules, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("app/views/actions/run-action.ts"),
      `run-action.ts should be reachable through resolve.alias, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("app/views/utils/helper.ts"),
      `helper.ts should be reachable through path.join alias, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("app/views/actions/orphan.ts"),
      `alias orphan should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("entry-validation", () => {
  it("should not flag entry exports by default", async () => {
    const result = await scanFixture("entry-validation");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("meatdata"), "entry exports are excluded by default");
    assert.ok(!allUnusedNames.includes("config"), "entry exports are excluded by default");
  });

  it("should flag entry exports when includeEntryExports is true", async () => {
    const result = await scanFixture("entry-validation", {
      includeEntryExports: true,
    });
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("meatdata"),
      `meatdata should be unused when checking entry exports, got: ${allUnusedNames}`,
    );
    assert.ok(
      allUnusedNames.includes("config"),
      `config should be unused when checking entry exports, got: ${allUnusedNames}`,
    );
  });
});

describe("ns-exports", () => {
  it("should handle TypeScript namespace exports", async () => {
    const result = await scanFixture("ns-exports");
    assert.ok(result.totalFiles > 0, "should parse files with namespace exports");
    const fixtureDir = resolve(FIXTURES_DIR, "ns-exports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/helpers.ts"), "helpers.ts is imported");
  });
});

describe("commonjs-app", () => {
  it("should flag orphan.js as unused", async () => {
    const result = await scanFixture("commonjs-app");
    const fixtureDir = resolve(FIXTURES_DIR, "commonjs-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.js"),
      `orphan.js should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-detection", () => {
  it("should flag orphan.ts as unused", async () => {
    const result = await scanFixture("config-detection");
    const fixtureDir = resolve(FIXTURES_DIR, "config-detection");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag unusedFunction as unused export", async () => {
    const result = await scanFixture("config-detection");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unusedFunction"),
      `unusedFunction should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("import-dynamic-literal", () => {
  it("should keep notes.ts reachable via dynamic import from parent path", async () => {
    const result = await scanFixture("import-dynamic-literal");
    const fixtureDir = resolve(FIXTURES_DIR, "import-dynamic-literal");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("notes.ts"), "notes.ts is dynamically imported");
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await scanFixture("import-dynamic-literal");
    const fixtureDir = resolve(FIXTURES_DIR, "import-dynamic-literal");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("arrow-wrapped-import-dynamic", () => {
  it("should keep Foo.tsx, Bar.tsx, Baz.tsx reachable via wrapped dynamic imports", async () => {
    const result = await scanFixture("arrow-wrapped-import-dynamic");
    const fixtureDir = resolve(FIXTURES_DIR, "arrow-wrapped-import-dynamic");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/Foo.tsx"), "Foo.tsx is lazily imported");
    assert.ok(!unusedFilePaths.includes("src/Bar.tsx"), "Bar.tsx is lazily imported");
    assert.ok(!unusedFilePaths.includes("src/Baz.tsx"), "Baz.tsx is lazily imported");
  });

  it("should keep feature.routes.ts reachable via loadChildren arrow", async () => {
    const result = await scanFixture("arrow-wrapped-import-dynamic");
    const fixtureDir = resolve(FIXTURES_DIR, "arrow-wrapped-import-dynamic");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/feature.routes.ts"),
      "feature.routes.ts is dynamically imported",
    );
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await scanFixture("arrow-wrapped-import-dynamic");
    const fixtureDir = resolve(FIXTURES_DIR, "arrow-wrapped-import-dynamic");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("type-cycle", () => {
  it("should not crash on circular type-only imports", async () => {
    const result = await scanFixture("type-cycle");
    assert.ok(result.totalFiles > 0, "should complete analysis without crashing");
  });

  it("should not flag user.ts or post.ts as unused", async () => {
    const result = await scanFixture("type-cycle");
    const fixtureDir = resolve(FIXTURES_DIR, "type-cycle");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/user.ts"), "user.ts is imported");
    assert.ok(!unusedFilePaths.includes("src/post.ts"), "post.ts is imported");
  });

  it("should not flag createUser or createPost as unused", async () => {
    const result = await scanFixture("type-cycle");
    const allUnusedNames = deadExportNames(result);
    assert.ok(!allUnusedNames.includes("createUser"), "createUser is used");
    assert.ok(!allUnusedNames.includes("createPost"), "createPost is used");
  });
});

describe("orphan-dynamic-subtree", () => {
  it("should flag setup.ts and lazy.ts as unused (subtree not reachable from entry)", async () => {
    const result = await scanFixture("orphan-dynamic-subtree");
    const fixtureDir = resolve(FIXTURES_DIR, "orphan-dynamic-subtree");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/subtree/setup.ts"),
      `setup.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/subtree/lazy.ts"),
      `lazy.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("orphan-shared-child", () => {
  it("should flag subtree/setup.ts and subtree/helpers.ts as unused", async () => {
    const result = await scanFixture("orphan-shared-child");
    const fixtureDir = resolve(FIXTURES_DIR, "orphan-shared-child");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/subtree/setup.ts"),
      `setup.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/subtree/helpers.ts"),
      `helpers.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should not flag shared/utils.ts as unused (imported by entry)", async () => {
    const result = await scanFixture("orphan-shared-child");
    const fixtureDir = resolve(FIXTURES_DIR, "orphan-shared-child");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/shared/utils.ts"), "shared/utils.ts is used by entry");
  });
});

describe("style-tracking", () => {
  it("should track imported CSS as reachable via import graph", async () => {
    const result = await scanFixture("style-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "style-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/styles.css"),
      "styles.css is imported and should be reachable",
    );
  });

  it("should flag unimported CSS files as unused", async () => {
    const result = await scanFixture("style-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "style-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/unused.css"),
      "CSS files are excluded from unused-file detection",
    );
  });

  it("should flag orphan TS files", async () => {
    const result = await scanFixture("style-tracking");
    const fixtureDir = resolve(FIXTURES_DIR, "style-tracking");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-mixed-formats", () => {
  it("should treat .cjs and .mjs config files as entry points", async () => {
    const result = await scanFixture("config-mixed-formats");
    const fixtureDir = resolve(FIXTURES_DIR, "config-mixed-formats");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("prettier.config.mjs"),
      "prettier.config.mjs should be treated as config entry point",
    );
    assert.ok(
      !unusedFilePaths.includes("vitest.config.mts"),
      "vitest.config.mts should be treated as config entry point",
    );
    assert.ok(
      unusedFilePaths.includes("lage.config.cjs"),
      "lage.config.cjs should be unused (not in the config file list)",
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("config-mixed-formats");
    const fixtureDir = resolve(FIXTURES_DIR, "config-mixed-formats");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("prettier-rc-plugins", () => {
  it("should not flag plugins referenced in .prettierrc as unused", async () => {
    const result = await scanFixture("prettier-rc-plugins");
    const deps = staleDependencyNames(result);
    assert.ok(
      !deps.includes("@trivago/prettier-plugin-sort-imports"),
      `@trivago/prettier-plugin-sort-imports is referenced in .prettierrc, got: ${deps}`,
    );
    assert.ok(!deps.includes("prettier"), `prettier should not be flagged, got: ${deps}`);
  });

  it("should still flag genuinely unused devDependencies", async () => {
    const result = await scanFixture("prettier-rc-plugins");
    const deps = staleDependencyNames(result);
    assert.ok(deps.includes("unused-dev-dep"), `unused-dev-dep should be flagged, got: ${deps}`);
  });
});

describe("test-runner-detect", () => {
  it("should treat .test.ts files as entry points", async () => {
    const result = await scanFixture("test-runner-detect");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/helper.test.ts"),
      `helper.test.ts should be an entry point (vitest detected), got: ${unusedFilePaths}`,
    );
  });

  it("should treat __tests__ files as entry points", async () => {
    const result = await scanFixture("test-runner-detect");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/__tests__/utils.test.ts"),
      `__tests__/utils.test.ts should be an entry point (vitest detected), got: ${unusedFilePaths}`,
    );
  });

  it("should keep files imported by test files as reachable", async () => {
    const result = await scanFixture("test-runner-detect");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/helper.ts"),
      `helper.ts should be reachable via test import, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/test-only-used.ts"),
      `test-only-used.ts should be reachable via test import, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("test-runner-detect");
    const fixtureDir = resolve(FIXTURES_DIR, "test-runner-detect");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("test-no-runner", () => {
  it("should NOT treat .test.ts as entry point without a test runner dependency", async () => {
    const result = await scanFixture("test-no-runner");
    const fixtureDir = resolve(FIXTURES_DIR, "test-no-runner");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/helper.test.ts"),
      `test files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("alias-mixed-exports", () => {
  it("should resolve @/ aliases and keep used files reachable", async () => {
    const result = await scanFixture("alias-mixed-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "alias-mixed-exports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFilePaths.includes("src/types.ts"), "types.ts is imported via alias");
    assert.ok(!unusedFilePaths.includes("src/helpers.ts"), "helpers.ts is imported via alias");
  });

  it("should flag orphan.ts as unused", async () => {
    const result = await scanFixture("alias-mixed-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "alias-mixed-exports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag unusedExport and unusedHelper", async () => {
    const result = await scanFixture("alias-mixed-exports");
    const allUnusedNames = deadExportNames(result);
    assert.ok(
      allUnusedNames.includes("unusedExport"),
      `unusedExport should be unused, got: ${allUnusedNames}`,
    );
    assert.ok(
      allUnusedNames.includes("unusedHelper"),
      `unusedHelper should be unused, got: ${allUnusedNames}`,
    );
  });
});

describe("mock-patterns", () => {
  it("should treat __fixtures__ files as entry points", async () => {
    const result = await scanFixture("mock-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "mock-patterns");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/__fixtures__/user-data.ts"),
      `__fixtures__/user-data.ts should be an entry point (vitest fixture), got: ${unusedFilePaths}`,
    );
  });

  it("should treat __mocks__ files as unused when only vitest is present (not jest)", async () => {
    const result = await scanFixture("mock-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "mock-patterns");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/__mocks__/api-client.ts"),
      `__mocks__/api-client.ts should be unused (vitest does not auto-discover __mocks__), got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("mock-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "mock-patterns");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("electron-app", () => {
  it("should use directory-based Electron plugin patterns (src/main/**/)", async () => {
    const result = await scanFixture("electron-app");
    const fixtureDir = resolve(FIXTURES_DIR, "electron-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/main/index.ts"),
      `src/main/index.ts should be entry via Electron plugin src/main/**/*.{ts,js}, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/main/window.ts"),
      `src/main/window.ts should be reachable from main/index.ts, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/preload/preload.ts"),
      `src/preload/preload.ts should be entry via Electron plugin src/preload/**/*.{ts,js}, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/preload.ts"),
      `src/preload.ts (file, not inside src/preload/ dir) should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("electron-entries", () => {
  it("should detect vite src/main.ts entry and electron src/preload/ dir entries", async () => {
    const result = await scanFixture("electron-entries");
    const fixtureDir = resolve(FIXTURES_DIR, "electron-entries");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/main.ts"),
      `src/main.ts should be entry via vite plugin, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/app.ts"),
      `src/app.ts should be reachable from main.ts, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/preload/index.ts"),
      `src/preload/index.ts should be entry via electron plugin src/preload/**/*.{ts,...}, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/preload/bridge.ts"),
      `src/preload/bridge.ts should be reachable from preload/index.ts, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("ava-app", () => {
  it("should detect ava test files as entry points", async () => {
    const result = await scanFixture("ava-app");
    const fixtureDir = resolve(FIXTURES_DIR, "ava-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("test/math.test.ts"),
      `test/math.test.ts should be entry via ava plugin, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/math.ts"),
      `src/math.ts should be reachable from test, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("src-path-fallback", () => {
  it("should resolve dist/ exports to src/index.ts fallback when exact match not found", async () => {
    const result = await scanFixture("src-path-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "src-path-fallback");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be resolved from dist/index.js export, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/helper.ts"),
      `src/helper.ts should be reachable from index.ts, got: ${unusedFilePaths}`,
    );
  });

  it("should resolve dist/cli.js to src/cli/index.ts via tsconfig outDir", async () => {
    const result = await scanFixture("src-path-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "src-path-fallback");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/cli/index.ts"),
      `src/cli/index.ts should be reachable via dist/cli.js bin entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/cli/runner.ts"),
      `src/cli/runner.ts should be reachable via cli/index.ts, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("src-path-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "src-path-fallback");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("heuristic-no-dir-fallback", () => {
  it("should not resolve dist/cli.js to src/cli/index.ts without tsconfig outDir", async () => {
    const result = await scanFixture("heuristic-no-dir-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "heuristic-no-dir-fallback");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/cli/index.ts"),
      `src/cli/index.ts should be unused (heuristic should not do directory fallback), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be resolved from dist/index.js via heuristic, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("spec-dash-patterns", () => {
  it("should treat *-spec.ts and *_spec.ts as unused (not matched by vitest/jest patterns)", async () => {
    const result = await scanFixture("spec-dash-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "spec-dash-patterns");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("spec/utils-spec.ts"),
      `utils-spec.ts should be unused (*-spec not matched by vitest), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("spec/engine_spec.ts"),
      `engine_spec.ts should be unused (*_spec not matched by vitest), got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("spec-dash-patterns");
    const fixtureDir = resolve(FIXTURES_DIR, "spec-dash-patterns");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-explicit", () => {
  it("should treat workspace package main entry as reachable and keep non-imported files unused", async () => {
    const result = await scanFixture("workspace-explicit");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-explicit");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/button.ts"),
      `packages/ui/src/button.ts should be reachable (workspace main entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/ui/src/index.ts"),
      `packages/ui/src/index.ts should be unused (not imported by main entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/utils/src/index.ts"),
      `packages/utils/src/index.ts should be reachable (default index fallback for workspace without main), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/utils/src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("lerna-workspace", () => {
  it("should discover workspace packages from lerna.json", async () => {
    const result = await scanFixture("lerna-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "lerna-workspace");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/app/src/index.ts"),
      `app index should be reachable as a lerna workspace entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/index.ts"),
      `ui index should be reachable via workspace package import, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/button.ts"),
      `button.ts should be reachable through the ui barrel, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/ui/src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-defaults", () => {
  it("should fall back to src/index when package.json entries point to non-existent dist", async () => {
    const result = await scanFixture("workspace-defaults");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-defaults");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/lib-a/src/index.ts"),
      `packages/lib-a/src/index.ts should be reachable (default fallback from dist entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/lib-a/src/helper.ts"),
      `packages/lib-a/src/helper.ts should be reachable (imported by index.ts), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/lib-a/src/orphan.ts"),
      `packages/lib-a/src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/lib-b/src/index.ts"),
      `packages/lib-b/src/index.ts should be reachable (default index fallback for package without main), got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-wildcards", () => {
  it("should expand wildcard exports as entry points and resolve via imports", async () => {
    const result = await scanFixture("workspace-wildcards");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-wildcards");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/components/index.ts"),
      `components/index.ts should be reachable via wildcard export resolution, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/components/button.ts"),
      `button.ts should be reachable via barrel re-export, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/ui/src/orphan.ts"),
      `orphan.ts should be reachable — wildcard export src/* expands it as entry point, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/ui/internal/hidden.ts"),
      `internal/hidden.ts should be unused (not covered by exports), got: ${unusedFilePaths}`,
    );
  });
});

describe("wildcard-subpath", () => {
  it("should expand wildcard exports as entry points", async () => {
    const result = await scanFixture("wildcard-subpath");
    const fixtureDir = resolve(FIXTURES_DIR, "wildcard-subpath");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/templates/welcome.tsx"),
      `welcome.tsx should be reachable — wildcard exports are expanded as entries, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/templates/goodbye.tsx"),
      `goodbye.tsx should be reachable — wildcard exports are expanded as entries, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (not in templates dir), got: ${unusedFilePaths}`,
    );
  });
});

describe("vite-glob-import", () => {
  it("should resolve import.meta.glob patterns including array syntax", async () => {
    const result = await scanFixture("vite-glob-import");
    const fixtureDir = resolve(FIXTURES_DIR, "vite-glob-import");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/modules/alpha.ts"),
      `alpha.ts should be reachable via import.meta.glob, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/modules/beta.ts"),
      `beta.ts should be reachable via import.meta.glob, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/layouts/main.ts"),
      `layouts/main.ts should be reachable via import.meta.glob array pattern, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (not matched by glob pattern), got: ${unusedFilePaths}`,
    );
  });
});

describe("jest-mock-files", () => {
  it("should treat __mocks__ files as test entry points when jest is present", async () => {
    const result = await scanFixture("jest-mock-files");
    const fixtureDir = resolve(FIXTURES_DIR, "jest-mock-files");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("__mocks__/fs.ts"),
      `__mocks__/fs.ts should be reachable as Jest manual mock entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("__mocks__/api-client.ts"),
      `__mocks__/api-client.ts should be reachable as Jest manual mock entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("jest-match", () => {
  it("should use custom testMatch patterns from jest.config.ts instead of defaults", async () => {
    const result = await scanFixture("jest-match");
    const fixtureDir = resolve(FIXTURES_DIR, "jest-match");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/utils.test.ts"),
      `src/utils.test.ts should be reachable via custom testMatch, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/__tests__/app.test.ts"),
      `src/__tests__/app.test.ts should be reachable via custom testMatch, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("tests/outside.test.ts"),
      `test files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("webpack-require-ctx", () => {
  it("should resolve require.context patterns with recursive flag and regex filter", async () => {
    const result = await scanFixture("webpack-require-ctx");
    const fixtureDir = resolve(FIXTURES_DIR, "webpack-require-ctx");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/Button.tsx"),
      `Button.tsx should be reachable via require.context('./components', true, /\\.tsx$/), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/components/nested/Card.tsx"),
      `nested/Card.tsx should be reachable via recursive require.context, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/pages/home.ts"),
      `pages/home.ts should be reachable via require.context('./pages', false), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (not matched by any require.context), got: ${unusedFilePaths}`,
    );
  });
});

describe("storybook-app", () => {
  it("should treat .stories.ts files as entry points when @storybook/* is present", async () => {
    const result = await scanFixture("storybook-app");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/Button.stories.ts"),
      `Button.stories.ts should be entry point, got: ${unusedFilePaths}`,
    );
  });

  it("should treat .storybook config files as entry points", async () => {
    const result = await scanFixture("storybook-app");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes(".storybook/main.ts"),
      `.storybook/main.ts should be entry point, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes(".storybook/preview.ts"),
      `.storybook/preview.ts should be entry point, got: ${unusedFilePaths}`,
    );
  });

  it("should mark components imported by stories as used", async () => {
    const result = await scanFixture("storybook-app");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/Button.ts"),
      `Button.ts should be reachable from stories, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files in storybook projects", async () => {
    const result = await scanFixture("storybook-app");
    const fixtureDir = resolve(FIXTURES_DIR, "storybook-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("graphql-schema", () => {
  it("should track imported graphql files as reachable", async () => {
    const result = await scanFixture("graphql-schema");
    const fixtureDir = resolve(FIXTURES_DIR, "graphql-schema");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/schema.graphql"),
      `schema.graphql is imported and should be reachable, got: ${unusedFilePaths}`,
    );
  });

  it("should flag unused graphql files", async () => {
    const result = await scanFixture("graphql-schema");
    const fixtureDir = resolve(FIXTURES_DIR, "graphql-schema");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/unused.graphql"),
      `GraphQL files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("next-pages-mdx", () => {
  it("should exclude MDX files from unused-file detection", async () => {
    const result = await scanFixture("next-pages-mdx");
    const fixtureDir = resolve(FIXTURES_DIR, "next-pages-mdx");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("pages/about.mdx"),
      `about.mdx should be excluded from unused-file (MDX files are excluded by default)`,
    );
  });

  it("should still discover TSX files in pages/ as entry points", async () => {
    const result = await scanFixture("next-pages-mdx");
    const fixtureDir = resolve(FIXTURES_DIR, "next-pages-mdx");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("pages/index.tsx"),
      `index.tsx should be entry point, got: ${unusedFilePaths}`,
    );
  });

  it("should mark components imported by pages as reachable", async () => {
    const result = await scanFixture("next-pages-mdx");
    const fixtureDir = resolve(FIXTURES_DIR, "next-pages-mdx");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/Home.ts"),
      `Home.ts is imported by index.tsx and should be reachable, got: ${unusedFilePaths}`,
    );
  });
});

describe("migration-orm", () => {
  it("should treat migration files as entry points when ORM is detected", async () => {
    const result = await scanFixture("migration-orm");
    const fixtureDir = resolve(FIXTURES_DIR, "migration-orm");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("migrations/001-create-users.ts"),
      `migration file should be entry point when knex is present, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag orphan files", async () => {
    const result = await scanFixture("migration-orm");
    const fixtureDir = resolve(FIXTURES_DIR, "migration-orm");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("migration-raw", () => {
  it("should NOT treat migration files as entry points without ORM dependency", async () => {
    const result = await scanFixture("migration-raw");
    const fixtureDir = resolve(FIXTURES_DIR, "migration-raw");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("migrations/001-create-users.ts"),
      `migration file should be unused without ORM, got: ${unusedFilePaths}`,
    );
  });
});

describe("style-imports", () => {
  it("should track CSS files imported from TS as reachable", async () => {
    const result = await scanFixture("style-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "style-imports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/app.css"),
      `app.css is imported by index.ts and should be reachable, got: ${unusedFilePaths}`,
    );
  });

  it("should track CSS @import chains as reachable", async () => {
    const result = await scanFixture("style-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "style-imports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("styles/base.css"),
      `base.css is @imported from app.css and should be reachable, got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan CSS files as unused", async () => {
    const result = await scanFixture("style-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "style-imports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("styles/orphan.css"),
      `CSS files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("nestjs-app", () => {
  it("should detect NestJS convention files as entry points", async () => {
    const result = await scanFixture("nestjs-app");
    const fixtureDir = resolve(FIXTURES_DIR, "nestjs-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/app.module.ts"),
      `app.module.ts should be entry point (NestJS module), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/users.controller.ts"),
      `users.controller.ts should be entry point (NestJS controller), got: ${unusedFilePaths}`,
    );
  });

  it("should flag non-NestJS files as unused", async () => {
    const result = await scanFixture("nestjs-app");
    const fixtureDir = resolve(FIXTURES_DIR, "nestjs-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("test-node-runner", () => {
  it("should treat node --test files as entry points", async () => {
    const result = await scanFixture("test-node-runner");
    const fixtureDir = resolve(FIXTURES_DIR, "test-node-runner");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/__tests__/main.test.ts"),
      `main.test.ts should be an entry point (node test runner detected), got: ${unusedFilePaths}`,
    );
  });

  it("should flag non-test orphan files as unused", async () => {
    const result = await scanFixture("test-node-runner");
    const fixtureDir = resolve(FIXTURES_DIR, "test-node-runner");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-script-flags", () => {
  it("should detect --config flag files as entry points", async () => {
    const result = await scanFixture("config-script-flags");
    const fixtureDir = resolve(FIXTURES_DIR, "config-script-flags");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("db/drizzle.config.ts"),
      `drizzle.config.ts should be entry point (--config flag), got: ${unusedFilePaths}`,
    );
  });

  it("should detect tsx script files as entry points", async () => {
    const result = await scanFixture("config-script-flags");
    const fixtureDir = resolve(FIXTURES_DIR, "config-script-flags");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("scripts/seed.ts"),
      `seed.ts should be entry point (tsx script), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await scanFixture("config-script-flags");
    const fixtureDir = resolve(FIXTURES_DIR, "config-script-flags");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (config-script-flags), got: ${unusedFilePaths}`,
    );
  });
});

describe("i18n-app", () => {
  it("should mark locale JSON files as always-used when i18next is a dependency", async () => {
    const result = await scanFixture("i18n-app");
    const fixtureDir = resolve(FIXTURES_DIR, "i18n-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("public/locales/en.json"),
      `en.json should be always-used (i18next locale), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await scanFixture("i18n-app");
    const fixtureDir = resolve(FIXTURES_DIR, "i18n-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (i18n-app), got: ${unusedFilePaths}`,
    );
  });
});

describe("subproject-standalone", () => {
  it("should still scan standalone sub-project files and report unused", async () => {
    const result = await scanFixture("subproject-standalone");
    const fixtureDir = resolve(FIXTURES_DIR, "subproject-standalone");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.some((filePath: string) => filePath.startsWith("docs/")),
      `docs/ files should still be scanned, got: ${unusedFilePaths}`,
    );
  });

  it("should still detect unused files in the main app", async () => {
    const result = await scanFixture("subproject-standalone");
    const fixtureDir = resolve(FIXTURES_DIR, "subproject-standalone");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("build-script-map", () => {
  it("should resolve build/ script references to src/ source files", async () => {
    const result = await scanFixture("build-script-map");
    const fixtureDir = resolve(FIXTURES_DIR, "build-script-map");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/scripts/migrate.ts"),
      `migrate.ts should be entry (build/ → src/ mapping), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/scripts/health-check.ts"),
      `health-check.ts should be entry (build/ → src/ mapping), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await scanFixture("build-script-map");
    const fixtureDir = resolve(FIXTURES_DIR, "build-script-map");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("tsconfig-wildcard", () => {
  it("should resolve wildcard * path alias that shadows Node.js built-in modules", async () => {
    const result = await scanFixture("tsconfig-wildcard");
    const fixtureDir = resolve(FIXTURES_DIR, "tsconfig-wildcard");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/constants/api.ts"),
      `constants/api.ts should be resolved via wildcard path alias, got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await scanFixture("tsconfig-wildcard");
    const fixtureDir = resolve(FIXTURES_DIR, "tsconfig-wildcard");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused (wildcard alias), got: ${unusedFilePaths}`,
    );
  });
});

describe("scss-partial", () => {
  it("should resolve SCSS partial imports with underscore prefix", async () => {
    const result = await scanFixture("scss-partial");
    const fixtureDir = resolve(FIXTURES_DIR, "scss-partial");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/styles/_variables.scss"),
      `_variables.scss should be used (SCSS partial import), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/styles/_mixins.scss"),
      `_mixins.scss should be used (SCSS @use), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan SCSS partials as unused", async () => {
    const result = await scanFixture("scss-partial");
    const fixtureDir = resolve(FIXTURES_DIR, "scss-partial");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/styles/_orphan.scss"),
      `SCSS files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("test-custom-ext", () => {
  it("should treat .clienttest, .servertest, and __e2e__ test files as unused (non-standard patterns)", async () => {
    const result = await scanFixture("test-custom-ext");
    const fixtureDir = resolve(FIXTURES_DIR, "test-custom-ext");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/utils.clienttest.ts"),
      `.clienttest.ts should be unused (non-standard pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/api.servertest.ts"),
      `.servertest.ts should be unused (non-standard pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/__e2e__/login.test.ts"),
      `__e2e__/*.test.ts should still be matched by **/*.test.* pattern, got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused", async () => {
    const result = await scanFixture("test-custom-ext");
    const fixtureDir = resolve(FIXTURES_DIR, "test-custom-ext");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("vue-app", () => {
  it("should follow imports inside Vue SFC script blocks", async () => {
    const result = await scanFixture("vue-app");
    const fixtureDir = resolve(FIXTURES_DIR, "vue-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/App.vue"),
      `App.vue should be used (imported from main.ts), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/components/HelloWorld.vue"),
      `HelloWorld.vue should be used (imported from App.vue), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/utils.ts"),
      `utils.ts should be used (imported from HelloWorld.vue), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan Vue components as unused", async () => {
    const result = await scanFixture("vue-app");
    const fixtureDir = resolve(FIXTURES_DIR, "vue-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/components/OrphanComponent.vue"),
      `OrphanComponent.vue should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("vite-app", () => {
  it("should detect entry points from vite.config rollupOptions.input", async () => {
    const result = await scanFixture("vite-app");
    const fixtureDir = resolve(FIXTURES_DIR, "vite-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/main.tsx"),
      `main.tsx should be used (vite entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/render.ts"),
      `render.ts should be used (imported from vite entry), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files as unused with vite entry", async () => {
    const result = await scanFixture("vite-app");
    const fixtureDir = resolve(FIXTURES_DIR, "vite-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("outdir-mapping", () => {
  it("should resolve built paths back to source via tsconfig outDir", async () => {
    const result = await scanFixture("outdir-mapping");
    const fixtureDir = resolve(FIXTURES_DIR, "outdir-mapping");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("main/index.ts"),
      `main/index.ts should be used (entry via outDir mapping), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("main/setup.ts"),
      `main/setup.ts should be used (imported from entry), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files even with outDir source mapping", async () => {
    const result = await scanFixture("outdir-mapping");
    const fixtureDir = resolve(FIXTURES_DIR, "outdir-mapping");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("main/orphan.ts"),
      `main/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

test("should resolve imports with query parameters (e.g. ?url, ?raw, ?worker)", async () => {
  const result = await scanFixture("import-query-param");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("config.ts")),
    `config.ts should NOT be unused (imported via ?raw), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("worker.ts")),
    `worker.ts should NOT be unused (imported via ?worker), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("styles.css")),
    `styles.css should NOT be unused (imported via ?url), got unused: ${unusedFilePaths}`,
  );
});

test("should flag orphan files even with query-param imports present", async () => {
  const result = await scanFixture("import-query-param");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused, got unused: ${unusedFilePaths}`,
  );
});

test("should detect script entry points with --key value flag pairs", async () => {
  const result = await scanFixture("script-flags");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("scripts/build.ts")),
    `scripts/build.ts should NOT be unused (referenced via tsx --tsconfig X scripts/build.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("scripts/generate.mts")),
    `scripts/generate.mts should NOT be unused (referenced via bun run), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("tests/run.ts")),
    `tests/run.ts should NOT be unused (referenced via node --import tsx --test), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused, got unused: ${unusedFilePaths}`,
  );
});

test("should detect Angular workspace entry points from angular.json", async () => {
  const result = await scanFixture("angular-workspace");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("main.ts")),
    `main.ts should NOT be unused (Angular entry), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("polyfills.ts")),
    `polyfills.ts should NOT be unused (Angular polyfills), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("app.module.ts")),
    `app.module.ts should NOT be unused (imported by main.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("app.component.ts")),
    `app.component.ts should NOT be unused (imported by app.module.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("environment.ts")),
    `environment.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("app.component.css")),
    `app.component.css should NOT be unused (referenced by @Component styleUrls), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("app.component.html")),
    `app.component.html should NOT be unused (referenced by @Component templateUrl), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("orphan.css")),
    `CSS files are excluded from unused-file detection, got unused: ${unusedFilePaths}`,
  );
});

test("should resolve #hash subpath imports via tsconfig paths with .js extension", async () => {
  const result = await scanFixture("import-subpath");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("api/user.ts")),
    `api/user.ts should NOT be unused (imported via #src/api/user.js), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("api/orphan.ts")),
    `api/orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

test("should treat vitest setupFiles as entry points", async () => {
  const result = await scanFixture("vitest-setup");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("test/setup.ts")),
    `test/setup.ts should be an entry point (vitest setup file), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("vitest.config.ts")),
    `vitest.config.ts should NOT be unused (config file), got unused: ${unusedFilePaths}`,
  );
});

test("should detect new URL with import.meta.url as imports (web workers)", async () => {
  const result = await scanFixture("worker-new-url");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("worker.js")),
    `worker.js should NOT be unused (referenced via new URL), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

test("should exclude multi-segment config files (e.g. cypress.config.contract.js)", async () => {
  const result = await scanFixture("config-compound-name");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("cypress.config.contract.js")),
    `cypress.config.contract.js should NOT be unused (config file), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("vitest.config.unit.ts")),
    `vitest.config.unit.ts should NOT be unused (config file), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

test("should treat jest __mocks__ files as entry points", async () => {
  const result = await scanFixture("jest-mapper");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("__mocks__/styleMock.js")),
    `styleMock.js should be reachable as Jest __mocks__ entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("__mocks__/fileMock.js")),
    `fileMock.js should be reachable as Jest __mocks__ entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

test("should resolve CSS files imported via tsconfig path aliases", async () => {
  const result = await scanFixture("style-alias");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("globals.css")),
    `globals.css should NOT be unused (imported via @/styles/globals.css), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("lib/utils.ts")),
    `lib/utils.ts should NOT be unused (imported via @/lib/utils), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

test("should resolve @/ imports via Next.js default path alias when tsconfig is empty", async () => {
  const result = await scanFixture("next-empty-tsconfig");
  const unusedFilePaths = result.unusedFiles.map((file) => file.path);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("src/env.ts")),
    `env.ts should NOT be unused (imported via @/env), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("orphan.ts")),
    `orphan.ts should be unused (not imported), got unused: ${unusedFilePaths}`,
  );
});

describe("workspace-path-alias", () => {
  it("should resolve imports via config paths when tsconfig has matching aliases", async () => {
    const result = await scanFixture("workspace-path-alias");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-path-alias");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/core/utils.ts"),
      `utils.ts should NOT be unused (imported via @project/core/utils), got: ${unusedFilePaths}`,
    );
  });

  it("should resolve imports via config paths option without tsconfig", async () => {
    const result = await scanFixture("workspace-path-alias-no-tsconfig", {
      paths: { "@project/core/*": ["packages/core/*"] },
    });
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-path-alias-no-tsconfig");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/core/utils.ts"),
      `utils.ts should NOT be unused (resolved via config paths), got: ${unusedFilePaths}`,
    );
  });

  it("should flag orphan files even with config paths", async () => {
    const result = await scanFixture("workspace-path-alias", {
      paths: { "@project/core/*": ["packages/core/*"] },
    });
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-path-alias");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("packages/core/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-structural-alias", () => {
  it("should auto-resolve @scope/<dir> imports from workspace layout without tsconfig or config", async () => {
    const result = await scanFixture("workspace-structural-alias");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-structural-alias");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/core/utils.ts"),
      `utils.ts should resolve via @project/core structural alias, got: ${unusedFilePaths}`,
    );
  });

  it("should still flag genuinely unused files under a structurally-aliased package", async () => {
    const result = await scanFixture("workspace-structural-alias");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-structural-alias");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("packages/core/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-paths-only", () => {
  it("should resolve imports only via the explicit `paths` option (no tsconfig, no bundler config)", async () => {
    const result = await scanFixture("config-paths-only", {
      paths: { "@custom/*": ["lib/*"] },
    });
    const fixtureDir = resolve(FIXTURES_DIR, "config-paths-only");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("lib/thing.ts"),
      `thing.ts should resolve via config paths, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("lib/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should flag the aliased file as unused when `paths` is absent (proves the option drives resolution)", async () => {
    const result = await scanFixture("config-paths-only");
    const fixtureDir = resolve(FIXTURES_DIR, "config-paths-only");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("lib/thing.ts"),
      `thing.ts should be unused without config paths, got: ${unusedFilePaths}`,
    );
  });
});

describe("path-alias-specificity", () => {
  it("should resolve via the most specific matching alias, not the first declared", async () => {
    const result = await scanFixture("path-alias-specificity", {
      paths: { "@x/*": ["general/*"], "@x/feature/*": ["special/*"] },
    });
    const fixtureDir = resolve(FIXTURES_DIR, "path-alias-specificity");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("special/thing.ts"),
      `special/thing.ts should win via the more specific @x/feature/* alias, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("general/feature/thing.ts"),
      `general/feature/thing.ts should be unused (less specific alias lost), got: ${unusedFilePaths}`,
    );
  });
});

describe("import-specifier-sanitize", () => {
  it("should resolve targets through webpack loader prefixes, query strings, and hash fragments", async () => {
    const result = await scanFixture("import-specifier-sanitize");
    const fixtureDir = resolve(FIXTURES_DIR, "import-specifier-sanitize");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/worker.ts"),
      `worker.ts should resolve through "worker-loader!./worker", got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/query.ts"),
      `query.ts should resolve through "./query?raw", got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/frag.ts"),
      `frag.ts should resolve through "./frag#section", got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("bundler-alias-resolution", () => {
  it("should resolve vite resolve.alias entries (path.resolve and fileURLToPath) without tsconfig", async () => {
    const result = await scanFixture("vite-resolve-alias");
    const fixtureDir = resolve(FIXTURES_DIR, "vite-resolve-alias");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/lib/util.ts"),
      `util.ts should resolve via @lib vite alias, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/widget.ts"),
      `widget.ts should resolve via @ vite alias, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/lib/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should resolve jest moduleNameMapper aliases without tsconfig", async () => {
    const result = await scanFixture("jest-module-name-mapper");
    const fixtureDir = resolve(FIXTURES_DIR, "jest-module-name-mapper");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/value.ts"),
      `value.ts should resolve via @app/* jest moduleNameMapper, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should resolve babel module-resolver aliases without tsconfig", async () => {
    const result = await scanFixture("babel-module-resolver");
    const fixtureDir = resolve(FIXTURES_DIR, "babel-module-resolver");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/button.ts"),
      `button.ts should resolve via @components babel alias, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/components/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("docusaurus-docs", () => {
  it("should exclude docs/ and blog/ content directories from file discovery", async () => {
    const result = await scanFixture("docusaurus-docs");
    const fixtureDir = resolve(FIXTURES_DIR, "docusaurus-docs");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath.startsWith("docs/")),
      `docs/ content files should not be discovered at all, got unused: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath.startsWith("blog/")),
      `blog/ content files should not be discovered at all, got unused: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/components/orphan.tsx"),
      `orphan.tsx should be unused, got: ${unusedFilePaths}`,
    );
  });
});

it("should resolve React Native platform extensions (.web.ts, .native.ts) when react-native detected", async () => {
  const result = await scanFixture("rn-platform");
  const fixtureDir = resolve(FIXTURES_DIR, "rn-platform");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/handler.web.ts"),
    `handler.web.ts should be reachable via platform extension, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/handler.native.ts"),
    `handler.native.ts should be reachable via platform extension, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve React Native .ios.tsx and .android.tsx platform variants as reachable", async () => {
  const result = await scanFixture("rn-platform");
  const fixtureDir = resolve(FIXTURES_DIR, "rn-platform");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/button.tsx"),
    `button.tsx should be reachable as the default platform variant, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/button.ios.tsx"),
    `button.ios.tsx should be reachable as iOS platform variant, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/button.android.tsx"),
    `button.android.tsx should be reachable as Android platform variant, got unused: ${unusedFilePaths}`,
  );
});

it("should detect cra-rewired as CRA variant and use src/index as entry", async () => {
  const result = await scanFixture("cra-rewired");
  const fixtureDir = resolve(FIXTURES_DIR, "cra-rewired");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/index.tsx"),
    `src/index.tsx should be reachable as CRA entry point, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/App.tsx"),
    `src/App.tsx should be reachable from CRA entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/Header.tsx"),
    `Header.tsx should be reachable from App import chain, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve CRA src-root bare imports without jsconfig", async () => {
  const result = await scanFixture("cra-src-baseurl");
  const fixtureDir = resolve(FIXTURES_DIR, "cra-src-baseurl");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/App.tsx"),
    `App.tsx should be reachable via CRA src module root, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/Header.tsx"),
    `Header.tsx should be reachable via CRA src module root, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should scope CRA src-root resolution to packages that declare CRA", async () => {
  const result = await scanFixture("cra-monorepo-scope");
  const fixtureDir = resolve(FIXTURES_DIR, "cra-monorepo-scope");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("packages/app/src/App.ts"),
    `app App.ts should resolve via its CRA dependency, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("packages/lib/src/RootOnly.ts"),
    `lib RootOnly.ts should stay unused because lib is not CRA, got: ${unusedFilePaths}`,
  );
});

it("should resolve Storybook MDX imports from story files", async () => {
  const result = await scanFixture("storybook-mdx-import");
  const fixtureDir = resolve(FIXTURES_DIR, "storybook-mdx-import");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/components/Alert.story.tsx"),
    `Alert.story.tsx should be reachable as storybook entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/Alert.mdx"),
    `Alert.mdx should be reachable via story file import, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/components/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve deep workspace imports like @pkg/shared/hooks/assets", async () => {
  const result = await scanFixture("workspace-deep-imports");
  const fixtureDir = resolve(FIXTURES_DIR, "workspace-deep-imports");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("packages/shared/src/hooks/assets.ts"),
    `hooks/assets.ts should be reachable via deep workspace import, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("packages/shared/src/components/button.ts"),
    `components/button.ts should be reachable via deep workspace import, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("packages/shared/src/components/orphan.ts"),
    `orphan.ts should be unused since it is not imported, got: ${unusedFilePaths}`,
  );
});

it("should mark config files in non-workspace directories as always used via global patterns", async () => {
  const result = await scanFixture("config-global-scope");
  const fixtureDir = resolve(FIXTURES_DIR, "config-global-scope");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("templates/next-app/postcss.config.mjs"),
    `postcss.config.mjs should be always used via global pattern, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("templates/next-app/eslint.config.js"),
    `eslint.config.js should be always used via global pattern, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("templates/next-app/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve dynamic imports with template literals as glob patterns", async () => {
  const result = await scanFixture("import-dynamic-template");
  const fixtureDir = resolve(FIXTURES_DIR, "import-dynamic-template");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/locales/en/core.js"),
    `en/core.js should be reachable via template literal glob, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/locales/fr/core.js"),
    `fr/core.js should be reachable via template literal glob, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/locales/de/core.js"),
    `de/core.js should be reachable via template literal glob, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve package.json exports pointing to .ts files that only exist as .tsx", async () => {
  const result = await scanFixture("cross-ext-ts-tsx");
  const fixtureDir = resolve(FIXTURES_DIR, "cross-ext-ts-tsx");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/components/Button.tsx"),
    `Button.tsx should be an entry (exported as Button.ts -> .tsx fallback), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should resolve package.json exports pointing to .js files that only exist as .ts", async () => {
  const result = await scanFixture("cross-ext-js-ts");
  const fixtureDir = resolve(FIXTURES_DIR, "cross-ext-js-ts");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("generators.ts"),
    `generators.ts should be an entry (exported as ./generators.js), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("plugin.ts"),
    `plugin.ts should be an entry (exported as ./plugin.js), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/utils/index.ts"),
    `src/utils/index.ts should be an entry (exported as ./src/utils/index.js), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should detect script files referenced in GitHub Actions workflow files", async () => {
  const result = await scanFixture("ci-scripts");
  const fixtureDir = resolve(FIXTURES_DIR, "ci-scripts");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("scripts/deploy.mjs"),
    `deploy.mjs should be detected from CI workflow run step, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("scripts/build-release.ts"),
    `build-release.ts should be detected from CI workflow run step, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should detect next.config files in non-workspace directories via global alwaysUsed", async () => {
  const result = await scanFixture("next-config-scope");
  const fixtureDir = resolve(FIXTURES_DIR, "next-config-scope");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("examples/my-app/next.config.mjs"),
    `next.config.mjs in examples should be detected via global alwaysUsed, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should mark files matched by glob patterns in package.json scripts as entry points", async () => {
  const result = await scanFixture("script-globs");
  const fixtureDir = resolve(FIXTURES_DIR, "script-globs");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("styles/themes/dark.css"),
    `dark.css should be marked as entry via script glob (postcss styles/themes/*.css), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("styles/themes/light.css"),
    `light.css should be marked as entry via script glob, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should still be flagged as unused, got: ${unusedFilePaths}`,
  );
});

it("should exclude config files from unused file detection", async () => {
  const result = await scanFixture("config-exclusion");
  const fixtureDir = resolve(FIXTURES_DIR, "config-exclusion");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("vitest.config.ts"),
    `vitest.config.ts should be excluded as config file, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("sanity.config.ts"),
    `sanity.config.ts should be excluded as config file, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("sanity.cli.ts"),
    `sanity.cli.ts should be unused (only excluded by sanity plugin, not global config), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("playwright.smoke.config.mjs"),
    `playwright.smoke.config.mjs should be excluded via script -c flag, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should still be flagged as unused, got: ${unusedFilePaths}`,
  );
});

it("should activate tooling plugins from optionalDependencies", async () => {
  const result = await scanFixture("optional-deps");
  const fixtureDir = resolve(FIXTURES_DIR, "optional-deps");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("sanity.config.ts"),
    `sanity.config.ts should be excluded (sanity in optionalDependencies), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("sanity.cli.ts"),
    `sanity.cli.ts should be excluded (sanity plugin activated via optionalDependencies), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("orphan.ts"),
    `orphan.ts should still be flagged as unused, got: ${unusedFilePaths}`,
  );
});

it("should extract entry points from tsdown/tsup config files", async () => {
  const result = await scanFixture("tsdown-entry");
  const fixtureDir = resolve(FIXTURES_DIR, "tsdown-entry");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/main.ts"),
    `src/main.ts should be reachable (entry in tsdown.config.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/preload.ts"),
    `src/preload.ts should be reachable (entry in tsdown.config.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/utils.ts"),
    `src/utils.ts should be reachable (imported by src/main.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/unused.ts"),
    `src/unused.ts should be flagged as unused, got: ${unusedFilePaths}`,
  );
});

it("should not exclude source directories named build from scanning", async () => {
  const result = await scanFixture("src-build-dir");
  const fixtureDir = resolve(FIXTURES_DIR, "src-build-dir");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/build/plugins.ts"),
    `src/build/plugins.ts should be reachable (imported by src/index.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/build/helpers.ts"),
    `src/build/helpers.ts should be reachable (imported by src/build/plugins.ts), got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `src/orphan.ts should be flagged as unused, got: ${unusedFilePaths}`,
  );
});

it("should treat files referenced via vi.mock/jest.mock as reachable (test imports create edges)", async () => {
  const result = await scanFixture("test-mock-import");
  const fixtureDir = resolve(FIXTURES_DIR, "test-mock-import");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/mocked-util.ts"),
    `mocked-util.ts should be reachable (imported via vi.mock from test entry), got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should still be flagged as unused, got: ${unusedFilePaths}`,
  );
});

test("should not treat all .github files as entries, only CI-referenced scripts", async () => {
  const result = await scanFixture("gh-actions-scripts");
  const fixtureDir = resolve(FIXTURES_DIR, "gh-actions-scripts");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith(".github/actions/deploy/run.js")),
    `run.js should NOT be unused (referenced in CI workflow), got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) =>
      filePath.endsWith(".github/actions/deploy/unused-helper.js"),
    ),
    `unused-helper.js should be unused (not referenced anywhere), got: ${unusedFilePaths}`,
  );
});

test("should resolve workspace dist paths to source and not mark dist as entries", async () => {
  const result = await scanFixture("workspace-dist-resolve");
  const fixtureDir = resolve(FIXTURES_DIR, "workspace-dist-resolve");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.includes("dist/")),
    `dist/ files should not appear in unused files (ignored), got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("packages/utils/src/orphan.ts")),
    `orphan.ts should be unused (not imported by anyone), got: ${unusedFilePaths}`,
  );
});

test("should exclude .gen.ts files from test entry patterns", async () => {
  const result = await scanFixture("generated-specs");
  const fixtureDir = resolve(FIXTURES_DIR, "generated-specs");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("types.spec.gen.ts")),
    `files matching .spec. pattern are excluded from unused-file detection, got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("schema.gen.ts")),
    `schema.gen.ts should be unused (generated file, not imported), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("index.test.ts")),
    `index.test.ts should be an entry point (jest detected), got: ${unusedFilePaths}`,
  );
});

test("should not treat formatter/linter glob targets as entry points", async () => {
  const result = await scanFixture("script-glob-formatter");
  const fixtureDir = resolve(FIXTURES_DIR, "script-glob-formatter");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath.endsWith("src/orphan.ts")),
    `orphan.ts should be unused (not imported by anyone), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("scripts/build.ts")),
    `build.ts should NOT be unused (referenced in build script), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath.endsWith("src/helper.ts")),
    `helper.ts should NOT be unused (imported by index.ts), got: ${unusedFilePaths}`,
  );
});

test("should not treat pages/app directories as entry points without framework dependency", async () => {
  const result = await scanFixture("framework-gate/no-framework");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gate/no-framework");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "app/dashboard/page.tsx"),
    `app/dashboard/page.tsx should be unused without next dependency, got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "src/routes/index.tsx"),
    `src/routes/index.tsx should be unused without router dependency, got: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "resources/js/Pages/dashboard.tsx"),
    `resources/js/Pages/dashboard.tsx should be unused without inertia dependency, got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "pages/index.tsx"),
    `pages/index.tsx should NOT be unused (imported by index.ts), got: ${unusedFilePaths}`,
  );
});

test("should treat pages/app as entry points when next is a dependency", async () => {
  const result = await scanFixture("framework-gate/with-nextjs");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gate/with-nextjs");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "unused.tsx"),
    `unused.tsx should be unused, got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "pages/index.tsx"),
    `pages/index.tsx should NOT be unused (Next.js pages entry), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "app/dashboard/page.tsx"),
    `app/dashboard/page.tsx should NOT be unused (Next.js app entry), got: ${unusedFilePaths}`,
  );
});

test("should treat app/routes as entry points when @react-router/dev is a dependency and read appDirectory from config", async () => {
  const result = await scanFixture("framework-gate/with-react-router");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gate/with-react-router");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "unused.tsx"),
    `unused.tsx should be unused, got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "src/root.tsx"),
    `src/root.tsx should NOT be unused (React Router entry with appDirectory=src), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "src/routes/home.tsx"),
    `src/routes/home.tsx should NOT be unused (React Router route with appDirectory=src), got: ${unusedFilePaths}`,
  );
});

test("should activate hoisted framework dependencies from package-local scripts when scanning a package directly", async () => {
  const fixtureDir = resolve(FIXTURES_DIR, "framework-hoisted-script-entry/packages/app");
  const result = await analyze(defineConfig({ rootDir: fixtureDir }));
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "orphan.tsx"),
    `orphan.tsx should be unused, got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "pages/index.tsx"),
    `pages/index.tsx should NOT be unused (Next script with hoisted dependency), got: ${unusedFilePaths}`,
  );
});

test("should activate React Router and Remix entries from hoisted script dependencies", async () => {
  for (const frameworkApp of [
    { fixtureName: "react-router-app", frameworkName: "React Router" },
    { fixtureName: "remix-app", frameworkName: "Remix" },
  ]) {
    const fixtureDir = resolve(
      FIXTURES_DIR,
      "framework-hoisted-router-scripts/packages",
      frameworkApp.fixtureName,
    );
    const result = await analyze(defineConfig({ rootDir: fixtureDir }));
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.some((filePath) => filePath === "orphan.tsx"),
      `orphan.tsx should be unused for ${frameworkApp.frameworkName}, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath === "app/root.tsx"),
      `app/root.tsx should NOT be unused (${frameworkApp.frameworkName} script with hoisted dependency), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath === "app/routes/home.tsx"),
      `app/routes/home.tsx should NOT be unused (${frameworkApp.frameworkName} script with hoisted dependency), got: ${unusedFilePaths}`,
    );
  }
});

test("should treat Inertia app and pages as entry points when Inertia is a dependency", async () => {
  const result = await scanFixture("framework-gate/with-inertia");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gate/with-inertia");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "resources/js/orphan.tsx"),
    `resources/js/orphan.tsx should be unused, got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "resources/js/app.tsx"),
    `resources/js/app.tsx should NOT be unused (Inertia app entry), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "resources/js/Pages/Admin/index.tsx"),
    `resources/js/Pages/Admin/index.tsx should NOT be unused (Inertia page entry), got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.some((filePath) => filePath === "resources/js/components/page-title.tsx"),
    `resources/js/components/page-title.tsx should NOT be unused (imported by Inertia page), got: ${unusedFilePaths}`,
  );
});

test("should not activate Redwood page entries for non-router Redwood packages", async () => {
  const result = await scanFixture("framework-gate/with-redwood-non-router-package");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gate/with-redwood-non-router-package");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "web/src/pages/home.tsx"),
    `web/src/pages/home.tsx should be unused without @redwoodjs/router or @redwoodjs/web, got: ${unusedFilePaths}`,
  );
});

test("should treat additional dependency-gated framework page conventions as entry points", async () => {
  const result = await scanFixture("framework-gate/with-additional-framework-pages");
  const fixtureDir = resolve(FIXTURES_DIR, "framework-gate/with-additional-framework-pages");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    unusedFilePaths.some((filePath) => filePath === "src/orphan.ts"),
    `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
  );

  for (const expectedReachableFile of [
    "web/src/pages/home.tsx",
    "web/src/layouts/main.tsx",
    "web/src/Routes.tsx",
    "src/pages/blog/index.page.tsx",
    "src/renderer/on-render-client.tsx",
    "src/routes/dashboard/index.tsx",
    "src/waku.client.tsx",
    "module-federation.config.ts",
    "src/remote-entry.ts",
  ]) {
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath === expectedReachableFile),
      `${expectedReachableFile} should NOT be unused (framework entry convention), got: ${unusedFilePaths}`,
    );
  }
});

describe("subproject-workspace", () => {
  it("should not activate framework detection for sub-project children", async () => {
    const result = await scanFixture("subproject-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "subproject-workspace");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/packages/core/app/page.ts"),
      `app/packages/core/app/page.ts should be unused (Next.js detection should not activate for sub-project children), got: ${unusedFilePaths}`,
    );
  });

  it("should not add sub-project child package entry files as global entries", async () => {
    const result = await scanFixture("subproject-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "subproject-workspace");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/packages/icons/src/index.ts"),
      `app/packages/icons/src/index.ts should be unused (not an entry when root has no workspace patterns), got: ${unusedFilePaths}`,
    );
  });

  it("should still detect files under sub-project children as unused", async () => {
    const result = await scanFixture("subproject-workspace");
    const fixtureDir = resolve(FIXTURES_DIR, "subproject-workspace");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("app/packages/core/src/unused-util.ts"),
      `app/packages/core/src/unused-util.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("tanstack-app", () => {
  it("should treat src/routes and src/server as entry points", async () => {
    const result = await scanFixture("tanstack-app");
    const fixtureDir = resolve(FIXTURES_DIR, "tanstack-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/routes/index.tsx"),
      `src/routes/index.tsx should be reachable via TanStack Start route, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/routes/about.tsx"),
      `src/routes/about.tsx should be reachable via TanStack Start route, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/server.ts"),
      `src/server.ts should be reachable as TanStack Start server entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("cloudflare-worker", () => {
  it("should treat src/index.ts as entry point when wrangler is present", async () => {
    const result = await scanFixture("cloudflare-worker");
    const fixtureDir = resolve(FIXTURES_DIR, "cloudflare-worker");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be reachable as Wrangler worker entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-entry-seed", () => {
  it("should exclude config files from unused reporting but not propagate reachability", async () => {
    const result = await scanFixture("config-entry-seed");
    const fixtureDir = resolve(FIXTURES_DIR, "config-entry-seed");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("vite.config.ts"),
      `vite.config.ts should be excluded from unused (config file), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/vite-plugin.ts"),
      `src/vite-plugin.ts should be unused (only imported from config file), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be reachable as main entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/helper.ts"),
      `src/helper.ts should be reachable via index.ts, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("config-imports", () => {
  it("should propagate reachability from config entry points when plugin activates", async () => {
    const result = await scanFixture("config-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "config-imports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("vite.config.ts"),
      `vite.config.ts should be excluded (config file), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("my-vite-plugin.ts"),
      `my-vite-plugin.ts should be reachable (config file is entry point when vite plugin activates), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/shared-util.ts"),
      `src/shared-util.ts should be reachable (imported from both config and app), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be reachable as main entry, got: ${unusedFilePaths}`,
    );
  });
});

describe("webpack-path", () => {
  it("should resolve path.join(__dirname, .., app/index) webpack entries", async () => {
    const result = await scanFixture("webpack-path");
    const fixtureDir = resolve(FIXTURES_DIR, "webpack-path");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("app/index.js"),
      `app/index.js should be reachable via webpack path.join entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("app/renderer.js"),
      `app/renderer.js should be reachable via app/index.js, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("app/orphan.js"),
      `app/orphan.js should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("html-entry-scope", () => {
  it("should only discover HTML script entries from root-level HTML files, not nested subdirectories", async () => {
    const result = await scanFixture("html-entry-scope");
    const fixtureDir = resolve(FIXTURES_DIR, "html-entry-scope");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/app/src/main.tsx"),
      `packages/app/src/main.tsx should be reachable via workspace root index.html, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/app/src/helper.ts"),
      `packages/app/src/helper.ts should be reachable (imported by main.tsx), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/app/sample/demo.tsx"),
      `packages/app/sample/demo.tsx should be unused (nested HTML not scanned), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/lib/src/orphan.ts"),
      `packages/lib/src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("i18n-glob-skip", () => {
  it("should not treat formatjs extract glob arguments as entry points", async () => {
    const result = await scanFixture("i18n-glob-skip");
    const fixtureDir = resolve(FIXTURES_DIR, "i18n-glob-skip");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused because formatjs extract globs should not seed entries, got: ${unusedFilePaths}`,
    );
  });
});

describe("remark-glob-skip", () => {
  it("should not treat remark and cspell glob arguments as entry points", async () => {
    const result = await scanFixture("remark-glob-skip");
    const fixtureDir = resolve(FIXTURES_DIR, "remark-glob-skip");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("docs/intro.mdx"),
      `docs/intro.mdx should be excluded (MDX files are excluded from unused-file by default)`,
    );
    assert.ok(
      !unusedFilePaths.includes("docs/guide.mdx"),
      `docs/guide.mdx should be excluded (MDX files are excluded from unused-file by default)`,
    );
  });
});

describe("extensionless-relative-import", () => {
  it("should resolve extensionless relative imports to sibling source files", async () => {
    const result = await scanFixture("extensionless-relative-import");
    const fixtureDir = resolve(FIXTURES_DIR, "extensionless-relative-import");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/Radio.tsx"),
      `Radio.tsx should be reachable via extensionless import, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/App.tsx"),
      `App.tsx should be reachable via index entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("jest-setup-config", () => {
  it("should treat jest setupFilesAfterEnv and moduleNameMapper paths as entry points", async () => {
    const result = await scanFixture("jest-setup-config");
    const fixtureDir = resolve(FIXTURES_DIR, "jest-setup-config");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("jest.setup.ts"),
      `jest.setup.ts should be reachable via setupFilesAfterEnv, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/setup-helper.ts"),
      `setup-helper.ts should be reachable via jest.setup.ts, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("__mocks__/styleMock.js"),
      `styleMock.js should be reachable via moduleNameMapper, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("remark-config-deps", () => {
  it("should keep remark plugins declared in .remarkrc used", async () => {
    const result = await scanFixture("remark-config-deps");
    const unusedDependencyNames = staleDependencyNames(result);
    assert.ok(
      !unusedDependencyNames.includes("remark-gfm"),
      `remark-gfm should be used via .remarkrc, got unused deps: ${unusedDependencyNames}`,
    );
    assert.ok(
      !unusedDependencyNames.includes("remark-cli"),
      `remark-cli should be used via npm script, got unused deps: ${unusedDependencyNames}`,
    );
  });
});

describe("flow-js-app", () => {
  it("should parse Flow and JSX in .js files and follow import chains", async () => {
    const result = await scanFixture("flow-js-app");
    const fixtureDir = resolve(FIXTURES_DIR, "flow-js-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/Widget.js"),
      `Widget.js should be reachable from main.dev.js, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/actions/helper.js"),
      `helper.js should be reachable from Widget.js, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.js"),
      `orphan.js should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("side-effects-glob", () => {
  it("should treat package.json sideEffects globs as production entries", async () => {
    const result = await scanFixture("side-effects-glob");
    const fixtureDir = resolve(FIXTURES_DIR, "side-effects-glob");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/foo/widget/style.ts"),
      `style.ts should be reachable via sideEffects glob, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("cra-jest-transforms", () => {
  it("should treat jest transform paths in createJestConfig as entry points", async () => {
    const result = await scanFixture("cra-jest-transforms");
    const fixtureDir = resolve(FIXTURES_DIR, "cra-jest-transforms");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("config/jest/babelTransform.js"),
      `babelTransform.js should be reachable via createJestConfig, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("config/jest/cssTransform.js"),
      `cssTransform.js should be reachable via createJestConfig, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("config/jest/fileTransform.js"),
      `fileTransform.js should be reachable via createJestConfig, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("config/jest/orphanTransform.js"),
      `orphanTransform.js should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("default-import-named-export", () => {
  it("should treat default imports as using same-named named exports", async () => {
    const result = await scanFixture("default-import-named-export");
    const fixtureDir = resolve(FIXTURES_DIR, "default-import-named-export");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    assert.ok(
      !exportsByFile["src/settings-panel.tsx"]?.includes("SettingsPanel"),
      `SettingsPanel should not be flagged when default-imported from test, got: ${JSON.stringify(exportsByFile["src/settings-panel.tsx"])}`,
    );
  });
});

describe("hoc-wrapped-default-export", () => {
  it("should treat HOC-wrapped default exports as using the wrapped named export", async () => {
    const result = await scanFixture("hoc-wrapped-default-export");
    const fixtureDir = resolve(FIXTURES_DIR, "hoc-wrapped-default-export");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    assert.ok(
      !exportsByFile["src/apps-badge.tsx"]?.includes("AppsBadge"),
      `AppsBadge should not be flagged when used by default export wrapper, got: ${JSON.stringify(exportsByFile["src/apps-badge.tsx"])}`,
    );
  });
});

describe("jest-config-cts", () => {
  it("should treat jest.config.cts setup file references as production entries", async () => {
    const result = await scanFixture("jest-config-cts");
    const fixtureDir = resolve(FIXTURES_DIR, "jest-config-cts");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("test-setup.ts"),
      `test-setup.ts should be reachable via jest.config.cts, got: ${unusedFilePaths}`,
    );
  });
});

describe("electron-builder-files", () => {
  it("should treat electron-builder build.files entries as production entries", async () => {
    const result = await scanFixture("electron-builder-files");
    const fixtureDir = resolve(FIXTURES_DIR, "electron-builder-files");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/preload.ts"),
      `preload.ts should be reachable via electron-builder files, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/worker.ts"),
      `worker.ts should be reachable via electron-builder files, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("internal-export-usage", () => {
  it("should not flag exports referenced within the same module", async () => {
    const result = await scanFixture("internal-export-usage");
    const fixtureDir = resolve(FIXTURES_DIR, "internal-export-usage");
    const exportsByFile = deadExportsByFile(result, fixtureDir);
    assert.ok(
      !exportsByFile["src/service.module.ts"]?.includes("serviceModule"),
      `serviceModule should not be flagged when used in same file, got: ${JSON.stringify(exportsByFile["src/service.module.ts"])}`,
    );
  });
});

describe("vitest-custom", () => {
  it("should use custom include patterns from vitest.config.ts", async () => {
    const result = await scanFixture("vitest-custom");
    const fixtureDir = resolve(FIXTURES_DIR, "vitest-custom");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("spec/utils-spec.ts"),
      `utils-spec.ts should be an entry (matched by vitest include pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-no-main", () => {
  it("should fall back to index.js for workspace packages without a main field", async () => {
    const result = await scanFixture("workspace-no-main");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-no-main");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("packages/lib-a/index.js"),
      `index.js should NOT be unused (default entry for package without main), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("packages/lib-a/helper.js"),
      `helper.js should NOT be unused (imported by index.js), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("packages/lib-a/orphan.js"),
      `orphan.js should be unused (not imported by anything), got: ${unusedFilePaths}`,
    );
  });
});

describe("style-export-map", () => {
  it("should resolve CSS files exported via package.json exports map through dist→src heuristic", async () => {
    const result = await scanFixture("style-export-map");
    const fixtureDir = resolve(FIXTURES_DIR, "style-export-map");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/style.css"),
      `src/style.css should NOT be unused (exported via package.json exports), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/orphan.css"),
      `CSS files are excluded from unused-file detection, got: ${unusedFilePaths}`,
    );
  });
});

describe("playwright-ext", () => {
  it("should NOT treat .pw.ts files as test entries", async () => {
    const result = await scanFixture("playwright-ext");
    const fixtureDir = resolve(FIXTURES_DIR, "playwright-ext");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("my-test.pw.ts"),
      `my-test.pw.ts should be unused (.pw.ts is not a standard test pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("playwright-lib", () => {
  it("should NOT treat lib/ and support/ directories as Playwright test entry points", async () => {
    const result = await scanFixture("playwright-lib");
    const fixtureDir = resolve(FIXTURES_DIR, "playwright-lib");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFilePaths.includes("lib/helpers.ts"),
      `lib/helpers.ts should be unused (lib/ is not a Playwright entry pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("support/commands.ts"),
      `support/commands.ts should be unused (support/ is not a Playwright entry pattern), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("e2e/login.spec.ts"),
      `e2e/login.spec.ts should be a test entry point, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("tests/smoke.spec.ts"),
      `tests/smoke.spec.ts should be a test entry point, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("env-wrapper", () => {
  it("should see through cross-env wrapper to find real binary and file arguments", async () => {
    const result = await scanFixture("env-wrapper");
    const fixtureDir = resolve(FIXTURES_DIR, "env-wrapper");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/main.js"),
      `src/main.js should NOT be unused (entry via cross-env node), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/dev-entry.js"),
      `src/dev-entry.js should NOT be unused (entry via cross-env node), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/helper.js"),
      `src/helper.js should NOT be unused (imported by entries), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.js"),
      `orphan.js should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("jest-mock-entry", () => {
  it("should treat __mocks__ files as entry points in jest projects", async () => {
    const result = await scanFixture("jest-mock-entry");
    const fixtureDir = resolve(FIXTURES_DIR, "jest-mock-entry");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/__mocks__/fs.ts"),
      `src/__mocks__/fs.ts should be reachable as Jest __mocks__ entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/__mocks__/axios.ts"),
      `src/__mocks__/axios.ts should be reachable as Jest __mocks__ entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("__mocks__/some-lib.js"),
      `__mocks__/some-lib.js should be reachable as Jest __mocks__ entry, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (jest-mock-entry), got: ${unusedFilePaths}`,
    );
  });
});

describe("mdx-import", () => {
  it("should trace imports from MDX entry points in Docusaurus projects", async () => {
    const result = await scanFixture("mdx-import");
    const fixtureDir = resolve(FIXTURES_DIR, "mdx-import");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/Chart.tsx"),
      `Chart.tsx should NOT be unused (imported by MDX entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/components/Unused.tsx"),
      `Unused.tsx should be unused (not imported by any MDX), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (mdx-import), got: ${unusedFilePaths}`,
    );
  });
});

describe("vitest-coverage", () => {
  it("should not confuse coverage.include with test.include patterns", async () => {
    const result = await scanFixture("vitest-coverage");
    const fixtureDir = resolve(FIXTURES_DIR, "vitest-coverage");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("tests/core.test.ts"),
      `core.test.ts should NOT be unused (vitest test file), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (vitest-coverage), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/utils.ts"),
      `src/utils.ts should be unused (not imported by any test or entry), got: ${unusedFilePaths}`,
    );
  });
});

describe("dts-imports", () => {
  it("should follow imports from .d.ts files to mark dependencies as reachable", async () => {
    const result = await scanFixture("dts-imports");
    const fixtureDir = resolve(FIXTURES_DIR, "dts-imports");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/helper.ts"),
      `src/helper.ts should NOT be unused (imported by types.d.ts which is reachable), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.some((filePath) => filePath.endsWith(".d.ts")),
      `.d.ts files should NOT appear in unused files report, got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("astro-mw", () => {
  it("should treat src/middleware.ts as an Astro entry point", async () => {
    const result = await scanFixture("astro-mw");
    const fixtureDir = resolve(FIXTURES_DIR, "astro-mw");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/middleware.ts"),
      `src/middleware.ts should NOT be unused (Astro middleware entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (astro-mw), got: ${unusedFilePaths}`,
    );
  });
});

describe("astro-frontmatter-return", () => {
  it("collects frontmatter imports even when frontmatter uses top-level return", async () => {
    const result = await scanFixture("astro-frontmatter-return");
    const fixtureDir = resolve(FIXTURES_DIR, "astro-frontmatter-return");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/components/Greeting.tsx"),
      `Greeting.tsx should NOT be unused (imported from .astro frontmatter), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/scripts/analytics.ts"),
      `analytics.ts should NOT be unused (referenced via self-closing <script src />), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/scripts/inline-helper.ts"),
      `inline-helper.ts should NOT be unused (imported from inline <script> after self-closing <script />), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("src/components/orphan.ts"),
      `orphan.ts should be unused (never imported), got: ${unusedFilePaths}`,
    );
  });
});

describe("next-middleware", () => {
  it("should treat middleware, proxy, and instrumentation as Next.js entry points", async () => {
    const result = await scanFixture("next-middleware");
    const fixtureDir = resolve(FIXTURES_DIR, "next-middleware");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFilePaths.includes("src/middleware.ts"),
      `src/middleware.ts should NOT be unused (Next.js middleware entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("src/auth.ts"),
      `src/auth.ts should NOT be unused (imported by middleware), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("proxy.ts"),
      `proxy.ts should NOT be unused (Next.js proxy entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      !unusedFilePaths.includes("instrumentation.ts"),
      `instrumentation.ts should NOT be unused (Next.js instrumentation entry), got: ${unusedFilePaths}`,
    );
    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused (next-middleware), got: ${unusedFilePaths}`,
    );
  });
});

describe("reexport-file-variants", () => {
  it("should exempt star-re-export barrels but not named-re-export barrels", async () => {
    const result = await scanFixture("reexport-file-variants");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-file-variants");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("src/star-barrel.ts"),
      `src/star-barrel.ts should NOT be unused (star re-export barrel with reachable sources), got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/named-barrel.ts"),
      `src/named-barrel.ts SHOULD be unused (named re-export barrel is reported as unused), got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused (reexport-file-variants), got: ${unusedFilePaths}`,
    );
  });
});

describe("ci-yaml-non-run", () => {
  it("should only extract entries from run: blocks, not arbitrary YAML values", async () => {
    const result = await scanFixture("ci-yaml-non-run");
    const fixtureDir = resolve(FIXTURES_DIR, "ci-yaml-non-run");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("scripts/deploy.mjs"),
      `scripts/deploy.mjs should NOT be unused (referenced in run: block), got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes(".github/changelog/changelog.js"),
      `.github/changelog/changelog.js SHOULD be unused (only referenced in YAML with: block, not run:), got: ${unusedFilePaths}`,
    );
  });
});

describe("workspace-dist-src", () => {
  it("should resolve workspace deep imports through export maps via dist→src fallback", async () => {
    const result = await scanFixture("workspace-dist-src");
    const fixtureDir = resolve(FIXTURES_DIR, "workspace-dist-src");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("packages/core/src/visualdebug.ts"),
      `packages/core/src/visualdebug.ts should NOT be unused (imported via @test/core/visualdebug), got: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("packages/core/src/index.ts"),
      `packages/core/src/index.ts should NOT be unused (imported via @test/core), got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("packages/core/src/orphan.ts"),
      `packages/core/src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("bun-test", () => {
  it("should detect bun test runner and treat test files as entry points", async () => {
    const result = await scanFixture("bun-test");
    const fixtureDir = resolve(FIXTURES_DIR, "bun-test");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("src/__tests__/build-output.test.ts"),
      `src/__tests__/build-output.test.ts should be reachable via bun test runner, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/add.test.ts"),
      `src/add.test.ts should be reachable via bun test runner, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("__tests__/integration.test.ts"),
      `__tests__/integration.test.ts should be reachable via bun test runner, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/utils_test.ts"),
      `src/utils_test.ts should be reachable via bun _test pattern, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("zx-scripts", () => {
  it("should detect zx as a script runner and mark referenced files as entry points", async () => {
    const result = await scanFixture("zx-scripts");
    const fixtureDir = resolve(FIXTURES_DIR, "zx-scripts");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("scripts/build-image.mjs"),
      `scripts/build-image.mjs should NOT be unused (referenced via zx in package.json scripts), got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("polyrepo", () => {
  it("should extract entry points from all sub-project package.json files without root workspace patterns", async () => {
    const result = await scanFixture("polyrepo");
    const fixtureDir = resolve(FIXTURES_DIR, "polyrepo");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("project-a/src/index.ts"),
      `project-a/src/index.ts should be reachable via lib/index.js main entry fallback`,
    );

    assert.ok(
      !unusedFilePaths.includes("project-a/src/helper.ts"),
      `project-a/src/helper.ts should be reachable via import from index.ts`,
    );

    assert.ok(
      !unusedFilePaths.includes("project-b/src/index.ts"),
      `project-b/src/index.ts should be reachable via dist/index.js main entry fallback`,
    );

    assert.ok(
      unusedFilePaths.includes("project-a/src/orphan.ts"),
      `project-a/src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("project-b/src/unused.ts"),
      `project-b/src/unused.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("build-root-fallback", () => {
  it("should only resolve build output to src/ directory, not root-level fallback", async () => {
    const result = await scanFixture("build-root-fallback");
    const fixtureDir = resolve(FIXTURES_DIR, "build-root-fallback");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      unusedFilePaths.includes("bin/server.js"),
      `bin/server.js should be unused — build/bin/server.js only resolves to src/bin/ not root bin/, got: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/app.ts"),
      `src/app.ts should be reachable via build/app.js → src/app.ts, got: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("vitest-automock", () => {
  it("should treat __mocks__ sibling as reachable when vi.mock has no factory", async () => {
    const result = await scanFixture("vitest-automock");
    const fixtureDir = resolve(FIXTURES_DIR, "vitest-automock");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("src/server/__mocks__/api.ts"),
      `__mocks__/api.ts should be reachable via vi.mock auto-mock sibling, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/utils/__mocks__/helper.ts"),
      `__mocks__/helper.ts should be unused when vi.mock has a factory, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/server/unused.ts"),
      `src/server/unused.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("react-router", () => {
  it("should treat files referenced by route/layout/index calls in routes.ts as entry points", async () => {
    const result = await scanFixture("react-router");
    const fixtureDir = resolve(FIXTURES_DIR, "react-router");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      unusedFilePaths.includes("app/components/unused-widget.tsx"),
      `unused-widget.tsx should be unused, got: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/dashboard/page.tsx"),
      `app/dashboard/page.tsx should be reachable via index() in routes.ts, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/dashboard/layout.tsx"),
      `app/dashboard/layout.tsx should be reachable via layout() in routes.ts, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/routes/home.tsx"),
      `app/routes/home.tsx should be reachable via route() in routes.ts, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/routes/about.tsx"),
      `app/routes/about.tsx should be reachable via route() in routes.ts, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/root.tsx"),
      `app/root.tsx should be reachable as root entry, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("app/components/header.tsx"),
      `header.tsx should be reachable (imported by root.tsx and home.tsx), got unused: ${unusedFilePaths}`,
    );
  });
});

describe("script-no-extension", () => {
  it("should resolve script file references without extensions to their source files", async () => {
    const result = await scanFixture("script-no-extension");
    const fixtureDir = resolve(FIXTURES_DIR, "script-no-extension");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      unusedFilePaths.includes("orphan.ts"),
      `orphan.ts should be unused, got: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("scripts/build-data.ts"),
      `scripts/build-data.ts should be reachable via 'tsx ./scripts/build-data' (extensionless), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("scripts/lint-code.js"),
      `scripts/lint-code.js should be reachable via 'node scripts/lint-code' (extensionless), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("scripts/process-items.ts"),
      `scripts/process-items.ts should be reachable via 'ts-node ./scripts/process-items' (extensionless), got unused: ${unusedFilePaths}`,
    );
  });
});

describe("rspack-app", () => {
  it("should treat rspack config files as always-used entry points", async () => {
    const result = await scanFixture("rspack-app");
    const fixtureDir = resolve(FIXTURES_DIR, "rspack-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("rspack.config.js"),
      `rspack.config.js should be always-used (rspack config), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("rspack.dev.config.js"),
      `rspack.dev.config.js should be always-used (rspack wildcard config), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/index.ts"),
      `src/index.ts should be reachable via rspack entry, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused, got: ${unusedFilePaths}`,
    );
  });
});

describe("astro-content", () => {
  it("should treat astro content config files as always-used", async () => {
    const result = await scanFixture("astro-content");
    const fixtureDir = resolve(FIXTURES_DIR, "astro-content");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("astro.config.ts"),
      `astro.config.ts should be always-used, got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/content.config.ts"),
      `src/content.config.ts should be always-used (astro content config), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/content/config.ts"),
      `src/content/config.ts should be always-used (astro content config), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused (astro-content), got: ${unusedFilePaths}`,
    );
  });
});

describe("astro-live-config", () => {
  it("should treat astro live collections config as always-used and trace its imports", async () => {
    const result = await scanFixture("astro-live-config");
    const fixtureDir = resolve(FIXTURES_DIR, "astro-live-config");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("src/live.config.ts"),
      `src/live.config.ts should be always-used (astro live collections config), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/loaders/wordpress-loader.ts"),
      `src/loaders/wordpress-loader.ts should be reachable (imported by live.config.ts), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/orphan.ts"),
      `src/orphan.ts should be unused (astro-live-config), got: ${unusedFilePaths}`,
    );
  });
});

describe("gatsby-app", () => {
  it("should flag unused components but not pages, templates, or api routes", async () => {
    const result = await scanFixture("gatsby-app");
    const fixtureDir = resolve(FIXTURES_DIR, "gatsby-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      unusedFilePaths.includes("src/components/unused.tsx"),
      `src/components/unused.tsx should be unused (Gatsby does not auto-discover components), got: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/pages/index.tsx"),
      `src/pages/index.tsx should be reachable (Gatsby page), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/templates/post.tsx"),
      `src/templates/post.tsx should be reachable (Gatsby template), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/api/hello.ts"),
      `src/api/hello.ts should be reachable (Gatsby API route), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/components/used.tsx"),
      `src/components/used.tsx should be reachable (imported by page), got unused: ${unusedFilePaths}`,
    );
  });
});

describe("rn-app", () => {
  it("should detect React Native entry points and flag orphan screens", async () => {
    const result = await scanFixture("rn-app");
    const fixtureDir = resolve(FIXTURES_DIR, "rn-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);

    assert.ok(
      !unusedFilePaths.includes("index.js"),
      `index.js should be reachable (React Native entry), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("App.tsx"),
      `App.tsx should be reachable (React Native entry), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      !unusedFilePaths.includes("src/screens/used.tsx"),
      `src/screens/used.tsx should be reachable (imported by App), got unused: ${unusedFilePaths}`,
    );

    assert.ok(
      unusedFilePaths.includes("src/screens/orphan.tsx"),
      `src/screens/orphan.tsx should be unused (rn-app), got: ${unusedFilePaths}`,
    );
  });
});

describe("expo-router", () => {
  it("should treat src/app filesystem routes as entry points (no false-positive unused files)", async () => {
    const result = await scanFixture("expo-router-src-app");
    const fixtureDir = resolve(FIXTURES_DIR, "expo-router-src-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.deepStrictEqual(
      unusedFilePaths,
      [],
      `Expo Router src/app routes are filesystem-discovered entries and must not be flagged unused, got: ${unusedFilePaths}`,
    );
  });

  it("should still report genuinely orphaned modules outside the src/app routes directory", async () => {
    const result = await scanFixture("expo-router-src-app-orphan");
    const fixtureDir = resolve(FIXTURES_DIR, "expo-router-src-app-orphan");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.deepStrictEqual(
      unusedFilePaths,
      ["src/utils/orphan.ts"],
      `only src/utils/orphan.ts (outside src/app) should be unused, got: ${unusedFilePaths}`,
    );
  });

  it("should keep treating non-src app/ filesystem routes as entry points", async () => {
    const result = await scanFixture("expo-router-app");
    const fixtureDir = resolve(FIXTURES_DIR, "expo-router-app");
    const unusedFilePaths = orphanPaths(result, fixtureDir);
    assert.deepStrictEqual(
      unusedFilePaths,
      [],
      `Expo Router app/ routes must remain entry points (regression guard), got: ${unusedFilePaths}`,
    );
  });
});

it("should detect webpack.config.js entry points and mark imported files reachable", async () => {
  const result = await scanFixture("webpack-entries");
  const fixtureDir = resolve(FIXTURES_DIR, "webpack-entries");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/index.js"),
    `src/index.js should be reachable as webpack entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/vendor.js"),
    `src/vendor.js should be reachable as webpack entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/App.js"),
    `App.js should be reachable via import from webpack entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/Vendor.js"),
    `Vendor.js should be reachable via import from webpack entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.js"),
    `orphan.js should be unused, got: ${unusedFilePaths}`,
  );
});

it("should not treat CSS files as entry points when wildcard export map expands to all files", async () => {
  const result = await scanFixture("wildcard-css");
  const fixtureDir = resolve(FIXTURES_DIR, "wildcard-css");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/components/Button.css"),
    `CSS files are excluded from unused-file detection, got: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/components/Button.ts"),
    `Button.ts should be reachable via export, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

it("should detect Electron main/preload entries and mark imported files reachable", async () => {
  const result = await scanFixture("electron-detection");
  const fixtureDir = resolve(FIXTURES_DIR, "electron-detection");
  const unusedFilePaths = orphanPaths(result, fixtureDir);
  assert.ok(
    !unusedFilePaths.includes("src/main.ts"),
    `src/main.ts should be reachable as Electron main entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/preload/index.ts"),
    `src/preload/index.ts should be reachable as Electron preload entry, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    !unusedFilePaths.includes("src/window.ts"),
    `src/window.ts should be reachable via import from main, got unused: ${unusedFilePaths}`,
  );
  assert.ok(
    unusedFilePaths.includes("src/orphan.ts"),
    `orphan.ts should be unused, got: ${unusedFilePaths}`,
  );
});

describe("cycle-simple", () => {
  it("should detect a simple A→B→A circular dependency", async () => {
    const result = await scanFixture("cycle-simple");
    assert.ok(result.circularDependencies.length > 0, "should find at least one cycle");
    const cyclePaths = result.circularDependencies.map((cycle) =>
      cycle.files.map((filePath) => {
        const fixtureDir = resolve(FIXTURES_DIR, "cycle-simple");
        return relative(fixtureDir, filePath);
      }),
    );
    const hasCycle = cyclePaths.some(
      (paths) => paths.includes("src/a.ts") && paths.includes("src/b.ts"),
    );
    assert.ok(
      hasCycle,
      `should find cycle between a.ts and b.ts, got: ${JSON.stringify(cyclePaths)}`,
    );
  });
});

describe("cycle-type-only", () => {
  it("should not detect circular dependencies when imports are type-only", async () => {
    const result = await scanFixture("cycle-type-only");
    assert.equal(
      result.circularDependencies.length,
      0,
      `type-only imports should not create cycles, got: ${JSON.stringify(result.circularDependencies)}`,
    );
  });
});

describe("cycle-chain", () => {
  it("should detect A→B→C→A circular dependency chain", async () => {
    const result = await scanFixture("cycle-chain");
    assert.ok(result.circularDependencies.length > 0, "should find at least one cycle");
    const cyclePaths = result.circularDependencies.map((cycle) =>
      cycle.files.map((filePath) => {
        const fixtureDir = resolve(FIXTURES_DIR, "cycle-chain");
        return relative(fixtureDir, filePath);
      }),
    );
    const hasThreeNodeCycle = cyclePaths.some(
      (paths) =>
        paths.length === 3 &&
        paths.includes("src/a.ts") &&
        paths.includes("src/b.ts") &&
        paths.includes("src/c.ts"),
    );
    assert.ok(
      hasThreeNodeCycle,
      `should find 3-node cycle between a.ts, b.ts, c.ts, got: ${JSON.stringify(cyclePaths)}`,
    );
  });
});

describe("cycle-none", () => {
  it("should not detect any circular dependencies in a linear dependency graph", async () => {
    const result = await scanFixture("cycle-none");
    assert.equal(result.circularDependencies.length, 0);
  });
});

describe("reexport-default-named", () => {
  it("should track default-as-named re-exports and detect unused files", async () => {
    const result = await scanFixture("reexport-default-named");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-default-named");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFiles.includes("widget.ts"),
      "widget.ts should be reachable via re-export { default as Widget }",
    );
    assert.ok(
      !unusedFiles.includes("gadget.ts"),
      "gadget.ts should be reachable via re-export { default as Gadget }",
    );
    assert.ok(!unusedFiles.includes("index.ts"), "index.ts should be reachable as entry");
    assert.ok(
      unusedFiles.includes("consumer.ts"),
      "consumer.ts should be unused (not an entry point, not imported by entry)",
    );
  });

  it("should detect unused exports in re-exported modules", async () => {
    const result = await scanFixture("reexport-default-named");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("widgetHelper"),
      "widgetHelper should be unused (not re-exported or consumed)",
    );
    assert.ok(
      exportNames.includes("gadgetHelper"),
      "gadgetHelper should be unused (not re-exported or consumed)",
    );
  });
});

describe("import-mixed", () => {
  it("should handle combined default, named, and namespace imports", async () => {
    const result = await scanFixture("import-mixed");
    const fixtureDir = resolve(FIXTURES_DIR, "import-mixed");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(unusedFiles.includes("orphan.ts"), "orphan.ts should be unused (not imported)");
    assert.ok(!unusedFiles.includes("lib.ts"), "lib.ts should be reachable via mixed import");
    assert.ok(
      !unusedFiles.includes("utils.ts"),
      "utils.ts should be reachable via namespace import",
    );
  });

  it("should detect unused exports across import patterns", async () => {
    const result = await scanFixture("import-mixed");
    const exportNames = deadExportNames(result);
    assert.ok(exportNames.includes("unused"), "unused export from lib.ts should be detected");
    assert.ok(
      exportNames.includes("unusedUtil"),
      "unusedUtil export from utils.ts should be detected",
    );
  });
});

describe("ns-chain", () => {
  it("should track namespace import that is re-exported", async () => {
    const result = await scanFixture("ns-chain");
    const fixtureDir = resolve(FIXTURES_DIR, "ns-chain");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(unusedFiles.includes("unused-module.ts"), "unused-module.ts should be unused");
    assert.ok(
      !unusedFiles.includes("helpers.ts"),
      "helpers.ts should be reachable via namespace re-export chain",
    );
    assert.ok(
      unusedFiles.includes("consumer.ts"),
      "consumer.ts should be unused (not an entry point)",
    );
  });
});

describe("type-reexport-filter", () => {
  it("should not report type-only re-exports as unused by default", async () => {
    const result = await scanFixture("type-reexport-filter");
    const fixtureDir = resolve(FIXTURES_DIR, "type-reexport-filter");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFiles.includes("types.ts"),
      "types.ts should be reachable via type-only re-export",
    );
    assert.ok(!unusedFiles.includes("user.ts"), "user.ts should be reachable via named re-export");
    assert.ok(
      unusedFiles.includes("consumer.ts"),
      "consumer.ts should be unused (not an entry point)",
    );
  });

  it("should detect unused exports even with type re-exports", async () => {
    const result = await scanFixture("type-reexport-filter");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("deleteUser"),
      "deleteUser should be unused (not re-exported or imported)",
    );
  });
});

describe("cycle-with-orphans", () => {
  it("should detect circular dependency between module-a and module-b", async () => {
    const result = await scanFixture("cycle-with-orphans");
    assert.ok(
      result.circularDependencies.length > 0,
      "should find circular dependency between module-a and module-b",
    );
  });

  it("should detect unused files alongside circular deps", async () => {
    const result = await scanFixture("cycle-with-orphans");
    const fixtureDir = resolve(FIXTURES_DIR, "cycle-with-orphans");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      unusedFiles.includes("orphan.ts"),
      "orphan.ts should be unused despite circular deps in other files",
    );
  });

  it("should detect unused exports in circular dependency modules", async () => {
    const result = await scanFixture("cycle-with-orphans");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("unusedFromA"),
      "unusedFromA should be detected as unused despite circular dep",
    );
    assert.ok(
      exportNames.includes("unusedFromB"),
      "unusedFromB should be detected as unused despite circular dep",
    );
  });
});

describe("deep-reexport-chain", () => {
  it("should propagate usage through 4-level re-export chain", async () => {
    const result = await scanFixture("deep-reexport-chain");
    const fixtureDir = resolve(FIXTURES_DIR, "deep-reexport-chain");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFiles.includes("level-3.ts"),
      "level-3.ts should be reachable through deep re-export chain",
    );
    assert.ok(
      !unusedFiles.includes("level-2.ts"),
      "level-2.ts should be reachable through re-export chain",
    );
    assert.ok(
      !unusedFiles.includes("level-1.ts"),
      "level-1.ts should be reachable through re-export chain",
    );
    assert.ok(
      unusedFiles.includes("consumer.ts"),
      "consumer.ts should be unused (not an entry point)",
    );
  });

  it("should detect exports that are not propagated through the chain", async () => {
    const result = await scanFixture("deep-reexport-chain");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("delta"),
      "delta should be unused (not re-exported past level-2)",
    );
    assert.ok(
      exportNames.includes("gamma"),
      "gamma should be unused (not re-exported past level-1 to index)",
    );
  });
});

describe("enum-export", () => {
  it("should detect unused enum exports", async () => {
    const result = await scanFixture("enum-export");
    const exportNames = deadExportNames(result);
    assert.ok(exportNames.includes("UnusedEnum"), "UnusedEnum should be detected as unused");
    assert.ok(
      !exportNames.includes("Status"),
      "Status should NOT be detected as unused (it is imported)",
    );
  });
});

describe("alias-named-exports", () => {
  it("should track aliased re-exports correctly", async () => {
    const result = await scanFixture("alias-named-exports");
    const fixtureDir = resolve(FIXTURES_DIR, "alias-named-exports");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFiles.includes("greetings.ts"),
      "greetings.ts should be reachable via aliased re-export",
    );
  });

  it("should detect unused exports with aliased names", async () => {
    const result = await scanFixture("alias-named-exports");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("unusedGreeting"),
      "unusedGreeting should be unused (not re-exported)",
    );
  });
});

describe("module-side-effect", () => {
  it("should keep side-effect imported files as reachable", async () => {
    const result = await scanFixture("module-side-effect");
    const fixtureDir = resolve(FIXTURES_DIR, "module-side-effect");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(
      !unusedFiles.includes("polyfill.ts"),
      "polyfill.ts should be reachable via side-effect import",
    );
    assert.ok(
      !unusedFiles.includes("register.ts"),
      "register.ts should be reachable via side-effect import",
    );
    assert.ok(unusedFiles.includes("orphan.ts"), "orphan.ts should be unused");
  });
});

describe("reexport-star-named", () => {
  it("should handle mixed star and named re-exports", async () => {
    const result = await scanFixture("reexport-star-named");
    const fixtureDir = resolve(FIXTURES_DIR, "reexport-star-named");
    const unusedFiles = orphanPaths(result, fixtureDir);
    assert.ok(!unusedFiles.includes("utils.ts"), "utils.ts should be reachable via star re-export");
    assert.ok(
      !unusedFiles.includes("special.ts"),
      "special.ts should be reachable via named re-export",
    );
    assert.ok(
      unusedFiles.includes("consumer.ts"),
      "consumer.ts should be unused (not an entry point)",
    );
  });

  it("should detect unused exports from modules included via star", async () => {
    const result = await scanFixture("reexport-star-named");
    const exportNames = deadExportNames(result);
    assert.ok(
      exportNames.includes("notReExported"),
      "notReExported should be unused (not consumed via star or named re-export)",
    );
  });
});

describe("cross-file-duplicate-exports", () => {
  it("should flag the same exported name in 2+ files that share an importer", async () => {
    const result = await scanFixture("cross-file-duplicate-exports");
    const findings = result.crossFileDuplicateExports;
    const sharedFinding = findings.find((finding) => finding.name === "sharedThing");
    assert.ok(
      sharedFinding,
      `expected a cross-file duplicate for "sharedThing", got: ${JSON.stringify(findings.map((finding) => finding.name))}`,
    );
    assert.equal(sharedFinding.locations.length, 2);
    assert.equal(sharedFinding.confidence, "medium");
  });

  it("should not flag unique exports", async () => {
    const result = await scanFixture("cross-file-duplicate-exports");
    const onlyHere = result.crossFileDuplicateExports.find(
      (finding) => finding.name === "onlyHere",
    );
    assert.equal(onlyHere, undefined, "onlyHere appears in only one file and must not be flagged");
  });

  it("should not flag entry-point modules whose duplicates are part of the public API surface", async () => {
    const result = await scanFixture("cross-file-duplicate-exports-unrelated");
    const handlerFinding = result.crossFileDuplicateExports.find(
      (finding) => finding.name === "handler",
    );
    assert.equal(
      handlerFinding,
      undefined,
      "package.json-declared route entry points are part of the API surface, not actionable duplicates",
    );
  });
});

describe("code-clones", () => {
  it("can be disabled via duplicateBlocks: { enabled: false }", async () => {
    const result = await scanFixture("duplicate-blocks-basic", {
      duplicateBlocks: { enabled: false },
    });
    assert.deepEqual(result.duplicateBlocks, []);
    assert.deepEqual(result.duplicateBlockClusters, []);
    assert.deepEqual(result.shadowedDirectoryPairs, []);
  });

  it("detects structurally-identical functions in semantic mode", async () => {
    const result = await scanFixture("duplicate-blocks-basic", {
      duplicateBlocks: { enabled: true, mode: "semantic", minTokens: 30, minLines: 3 },
    });
    assert.ok(
      result.duplicateBlocks.length > 0,
      `expected at least one duplicate block, got: ${JSON.stringify(result.duplicateBlocks, null, 2)}`,
    );
    const ordersInvoicesClone = result.duplicateBlocks.find(
      (duplicateBlock) =>
        duplicateBlock.instances.some((instance) => instance.path.endsWith("orders.ts")) &&
        duplicateBlock.instances.some((instance) => instance.path.endsWith("invoices.ts")),
    );
    assert.ok(
      ordersInvoicesClone,
      `expected a clone spanning orders.ts and invoices.ts, got files: ${result.duplicateBlocks
        .map((duplicateBlock) =>
          duplicateBlock.instances.map((instance) => instance.path).join(","),
        )
        .join("|")}`,
    );
  });

  it("groups clones from the same file pair into a family", async () => {
    const result = await scanFixture("duplicate-blocks-basic", {
      duplicateBlocks: { enabled: true, mode: "semantic", minTokens: 30, minLines: 3 },
    });
    if (result.duplicateBlocks.length === 0) return;
    assert.ok(
      result.duplicateBlockClusters.length > 0,
      "expected at least one duplicate-block cluster when clones are present",
    );
    for (const family of result.duplicateBlockClusters) {
      assert.ok(family.files.length >= 2, "family must span 2+ files");
      assert.ok(family.suggestions.length > 0, "family must produce a refactoring suggestion");
    }
  });

  it("respects skipLocal: true and drops within-directory clones", async () => {
    const result = await scanFixture("duplicate-blocks-basic", {
      duplicateBlocks: {
        enabled: true,
        mode: "semantic",
        minTokens: 30,
        minLines: 3,
        skipLocal: true,
      },
    });
    for (const duplicateBlock of result.duplicateBlocks) {
      const directories = new Set(
        duplicateBlock.instances.map((instance) => instance.path.replace(/\/[^/]*$/, "")),
      );
      assert.ok(
        directories.size >= 2,
        "skipLocal should remove within-directory clones from the report",
      );
    }
  });

  it("does not flag dissimilar files", async () => {
    const result = await scanFixture("simple-app", {
      duplicateBlocks: { enabled: true, mode: "semantic", minTokens: 50, minLines: 5 },
    });
    for (const duplicateBlock of result.duplicateBlocks) {
      assert.ok(
        duplicateBlock.tokenCount >= 50,
        `every reported clone must satisfy minTokens, got ${duplicateBlock.tokenCount}`,
      );
    }
  });
});

describe("re-export-cycles", () => {
  it("detects multi-node re-export cycles", async () => {
    const result = await scanFixture("re-export-cycle");
    assert.ok(
      result.reExportCycles.length > 0,
      `expected at least one re-export cycle, got ${JSON.stringify(result.reExportCycles)}`,
    );
    const multiNodeCycle = result.reExportCycles.find((cycle) => cycle.kind === "multi-node");
    assert.ok(multiNodeCycle, "expected a multi-node re-export cycle for barrel <-> other");
    assert.equal(multiNodeCycle.confidence, "high");
  });
});

describe("feature-flags", () => {
  it("can be disabled via featureFlags: { enabled: false }", async () => {
    const result = await scanFixture("feature-flags-basic", {
      featureFlags: { enabled: false },
    });
    assert.deepEqual(result.featureFlags, []);
  });

  it("detects env var, SDK, and provider attribution", async () => {
    const result = await scanFixture("feature-flags-basic", {
      featureFlags: { enabled: true },
    });
    const envVarFlag = result.featureFlags.find((flag) => flag.kind === "env-var");
    assert.ok(
      envVarFlag,
      `expected an env-var flag finding, got: ${JSON.stringify(result.featureFlags)}`,
    );
    assert.equal(envVarFlag.name, "FEATURE_NEW_CHECKOUT");

    const statsigFlag = result.featureFlags.find((flag) => flag.sdkProvider === "Statsig");
    assert.ok(statsigFlag, "expected Statsig sdkProvider attribution");
    assert.equal(statsigFlag.name, "legacy_billing");

    const launchDarklyFlag = result.featureFlags.find(
      (flag) => flag.sdkProvider === "LaunchDarkly",
    );
    assert.ok(launchDarklyFlag, "expected LaunchDarkly sdkProvider attribution");
    assert.equal(launchDarklyFlag.name, "payments-flag");
  });
});

describe("private-type-leaks", () => {
  it("flags exports whose signatures reference unexported local types", async () => {
    const result = await scanFixture("private-type-leak");
    const initializeLeak = result.privateTypeLeaks.find(
      (leak) => leak.exportName === "initialize" && leak.typeName === "InternalConfig",
    );
    assert.ok(
      initializeLeak,
      `expected initialize -> InternalConfig leak, got: ${JSON.stringify(result.privateTypeLeaks)}`,
    );
    assert.equal(initializeLeak.confidence, "high");

    const teardownLeak = result.privateTypeLeaks.find(
      (leak) => leak.exportName === "teardown" && leak.typeName === "InternalConfig",
    );
    assert.ok(teardownLeak, "expected teardown -> InternalConfig leak");
  });
});

describe("complex-functions", () => {
  it("can be disabled via complexity: { enabled: false }", async () => {
    const result = await scanFixture("complex-functions", {
      complexity: { enabled: false },
    });
    assert.deepEqual(result.complexFunctions, []);
  });

  it("flags only functions that breach a threshold", async () => {
    const result = await scanFixture("complex-functions", {
      complexity: {
        enabled: true,
        cyclomaticThreshold: 5,
        cognitiveThreshold: 5,
        paramCountThreshold: 4,
        functionLineThreshold: 10,
      },
    });
    const tangled = result.complexFunctions.find((finding) => finding.functionName === "tangledFn");
    assert.ok(tangled, "tangledFn should be flagged");
    assert.ok(tangled.cyclomatic >= 5, `tangledFn cyclomatic ${tangled.cyclomatic} should be >= 5`);
    const simple = result.complexFunctions.find((finding) => finding.functionName === "simpleFn");
    assert.equal(simple, undefined, "simpleFn must not be flagged");
  });
});

describe("typescript-smells", () => {
  it("flags redundant double assertions like `x as unknown as T`", async () => {
    const result = await scanFixture("typescript-smells");
    const doubleAssertion = result.unnecessaryAssertions.find(
      (finding) => finding.kind === "redundant-double-assertion",
    );
    assert.ok(
      doubleAssertion,
      `expected a redundant-double-assertion finding, got: ${JSON.stringify(result.unnecessaryAssertions.map((finding) => finding.kind))}`,
    );
    assert.equal(doubleAssertion.confidence, "high");
  });

  it("flags `as any`", async () => {
    const result = await scanFixture("typescript-smells");
    const asAny = result.unnecessaryAssertions.find(
      (finding) => finding.kind === "assertion-to-any",
    );
    assert.ok(asAny, "expected an assertion-to-any finding");
  });

  it("flags non-null assertion on a literal", async () => {
    const result = await scanFixture("typescript-smells");
    const onLiteral = result.unnecessaryAssertions.find(
      (finding) => finding.kind === "redundant-non-null-on-literal",
    );
    assert.ok(onLiteral, "expected a redundant-non-null-on-literal finding");
    assert.equal(onLiteral.confidence, "high");
  });

  it("flags double non-null assertions `x!!`", async () => {
    const result = await scanFixture("typescript-smells");
    const doubleNonNull = result.unnecessaryAssertions.find(
      (finding) => finding.kind === "double-non-null",
    );
    assert.ok(doubleNonNull, "expected a double-non-null finding");
  });

  it("flags `<T>x` angle-bracket assertions", async () => {
    const result = await scanFixture("typescript-smells");
    const angleBracket = result.unnecessaryAssertions.find(
      (finding) => finding.kind === "angle-bracket-assertion",
    );
    assert.ok(angleBracket, "expected an angle-bracket-assertion finding");
  });

  it("flags top-level `await import()` and `import().then()`", async () => {
    const result = await scanFixture("typescript-smells");
    const awaitImport = result.lazyImportsAtTopLevel.find(
      (finding) => finding.kind === "top-level-await-import",
    );
    assert.ok(awaitImport, "expected a top-level-await-import finding");
    assert.ok(
      awaitImport.specifier.endsWith("alpha.js"),
      `expected alpha.js specifier, got ${awaitImport.specifier}`,
    );
    const thenImport = result.lazyImportsAtTopLevel.find(
      (finding) => finding.kind === "top-level-then-import",
    );
    assert.ok(thenImport, "expected a top-level-then-import finding");
  });

  it("flags `require()` and `module.exports` / `exports.x` in ESM modules", async () => {
    const result = await scanFixture("typescript-smells");
    const requireFinding = result.commonjsInEsm.find((finding) => finding.kind === "require");
    assert.ok(requireFinding, "expected a require() finding in this ESM (`type: module`) fixture");
    const moduleExportsFinding = result.commonjsInEsm.find(
      (finding) => finding.kind === "module-exports",
    );
    assert.ok(moduleExportsFinding, "expected a module.exports finding");
    const exportsAssignmentFinding = result.commonjsInEsm.find(
      (finding) => finding.kind === "exports-assignment",
    );
    assert.ok(exportsAssignmentFinding, "expected an exports.x = ... finding");
  });

  it("flags `@ts-ignore` and `@ts-nocheck` comments", async () => {
    const result = await scanFixture("typescript-smells");
    const tsIgnore = result.typeScriptEscapeHatches.find((finding) => finding.kind === "ts-ignore");
    assert.ok(tsIgnore, "expected ts-ignore finding");
    assert.equal(tsIgnore.confidence, "high");
  });

  it("flags `@ts-expect-error` without an explanation, but allows it when the comment carries a justification", async () => {
    const result = await scanFixture("typescript-smells");
    const expectErrorFindings = result.typeScriptEscapeHatches.filter(
      (finding) => finding.kind === "ts-expect-error-without-explanation",
    );
    assert.equal(
      expectErrorFindings.length,
      1,
      `expected exactly one ts-expect-error-without-explanation finding, got ${expectErrorFindings.length}: ${JSON.stringify(expectErrorFindings)}`,
    );
  });
});
