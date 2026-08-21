import { describe, expect, it } from "vite-plus/test";
import { extractScriptFileReferences } from "../src/project-analysis/utils/extract-script-file-references.js";

describe("extractScriptFileReferences", () => {
  it("extracts quoted and unquoted script paths across shell commands", () => {
    expect(
      extractScriptFileReferences(
        'tsx "scripts/build registry.ts" && node scripts/post-build.mjs | bun scripts/publish.cts',
      ),
    ).toEqual(["scripts/build registry.ts", "scripts/post-build.mjs", "scripts/publish.cts"]);
  });

  it("ignores source-looking text that is part of another token", () => {
    expect(extractScriptFileReferences("echo source.ts.map --config=build.ts")).toEqual([]);
  });

  it("extracts compiler files from language mappings", () => {
    expect(extractScriptFileReferences("mocha --compilers css:mocha-compiler.js")).toEqual([
      "mocha-compiler.js",
    ]);
  });
});
