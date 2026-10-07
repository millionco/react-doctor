import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { defineProjectAnalysisConfig } from "../src/project-analysis/config.js";
import { createResolver } from "../src/project-analysis/resolver/resolve.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("project analysis source fallback", () => {
  it("does not map an unresolved relative output path to an unrelated source module", () => {
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-resolver-"));
    temporaryDirectories.push(rootDirectory);
    const sourceDirectory = path.join(rootDirectory, "src");
    fs.mkdirSync(sourceDirectory, { recursive: true });
    const entryPath = path.join(sourceDirectory, "index.ts");
    fs.writeFileSync(entryPath, 'import "./lib/foo.js";');
    fs.writeFileSync(path.join(sourceDirectory, "foo.ts"), "export const unrelated = true;");

    const resolver = createResolver(defineProjectAnalysisConfig({ rootDir: rootDirectory }));

    expect(resolver.resolveModule("./lib/foo.js", entryPath)).toEqual({
      resolvedPath: undefined,
      isExternal: false,
      packageName: undefined,
    });
  });
});
