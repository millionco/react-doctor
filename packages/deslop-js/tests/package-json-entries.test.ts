import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { extractPackageJsonEntries } from "../src/collect/package-json-entries.js";

const temporaryRoot = mkdtempSync(join(os.tmpdir(), "deslop-package-entries-"));

after(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("extractPackageJsonEntries", () => {
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
});
