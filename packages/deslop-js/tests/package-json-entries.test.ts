import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { extractPackageJsonEntries } from "../src/collect/package-json-entries.js";

const temporaryRoot = mkdtempSync(join(os.tmpdir(), "deslop-package-entries-"));

after(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("extractPackageJsonEntries", () => {
  it("collects package metadata entry categories in declaration order", async () => {
    const projectDirectory = join(temporaryRoot, "package-metadata-categories");
    const relativeEntryPaths = [
      "src/main.ts",
      "src/export.tsx",
      "src/wildcard.ts",
      "src/cli.ts",
      "src/side-effect.ts",
      "src/build-entry.ts",
      "src/jest-setup.ts",
    ];
    for (const relativeEntryPath of relativeEntryPaths) {
      const absoluteEntryPath = join(projectDirectory, relativeEntryPath);
      mkdirSync(dirname(absoluteEntryPath), { recursive: true });
      writeFileSync(absoluteEntryPath, "export const entry = true;\n");
    }

    const packageJsonPath = join(projectDirectory, "package.json");
    writeFileSync(
      packageJsonPath,
      JSON.stringify({
        main: "src/main.ts",
        exports: {
          ".": "./src/export.ts",
          "./wildcard": "./src/wildcard.*",
        },
        bin: { cli: "src/cli", ignored: false },
        sideEffects: ["src/side-effect.js", false],
        build: { files: ["src/build-entry", "src/*.ts", false] },
        jest: { setupFilesAfterEnv: ["<rootDir>/src/jest-setup"] },
      }),
    );

    const entries = await extractPackageJsonEntries(packageJsonPath);

    assert.deepEqual(
      entries,
      relativeEntryPaths.map((relativeEntryPath) => join(projectDirectory, relativeEntryPath)),
    );
  });

  it("does not treat sibling output-directory prefixes as descendants", async () => {
    const projectDirectory = join(temporaryRoot, "out-directory-prefix");
    const expectedSourcePath = join(projectDirectory, "src", "index.ts");
    const misleadingSourcePath = join(projectDirectory, "-other", "index.ts");
    mkdirSync(join(projectDirectory, "src"), { recursive: true });
    mkdirSync(join(projectDirectory, "-other"), { recursive: true });
    writeFileSync(expectedSourcePath, "export const expected = true;\n");
    writeFileSync(misleadingSourcePath, "export const misleading = true;\n");
    writeFileSync(
      join(projectDirectory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { outDir: "dist", rootDir: "." } }),
    );
    const packageJsonPath = join(projectDirectory, "package.json");
    writeFileSync(packageJsonPath, JSON.stringify({ main: "dist-other/index.js" }));

    const entries = await extractPackageJsonEntries(packageJsonPath);

    assert.ok(entries.includes(expectedSourcePath));
    assert.ok(!entries.includes(misleadingSourcePath));
  });

  it("prefers the configured source root over common source-directory fallbacks", async () => {
    const projectDirectory = join(temporaryRoot, "configured-source-root");
    const configuredSourcePath = join(projectDirectory, "source", "index.ts");
    const heuristicSourcePath = join(projectDirectory, "src", "index.ts");
    mkdirSync(dirname(configuredSourcePath), { recursive: true });
    mkdirSync(dirname(heuristicSourcePath), { recursive: true });
    writeFileSync(configuredSourcePath, "export const configured = true;\n");
    writeFileSync(heuristicSourcePath, "export const heuristic = true;\n");
    writeFileSync(
      join(projectDirectory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { outDir: "dist", rootDir: "source" } }),
    );
    const packageJsonPath = join(projectDirectory, "package.json");
    writeFileSync(packageJsonPath, JSON.stringify({ main: "dist/index.js" }));

    const entries = await extractPackageJsonEntries(packageJsonPath);

    assert.ok(entries.includes(configuredSourcePath));
    assert.ok(!entries.includes(heuristicSourcePath));
  });
});
