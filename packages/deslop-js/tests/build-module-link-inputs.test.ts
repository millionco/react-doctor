import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { parseSourceFile } from "../src/collect/parse.js";
import { buildModuleLinkInputs } from "../src/linker/build-module-link-inputs.js";

const temporaryRoot = mkdtempSync(join(os.tmpdir(), "deslop-module-link-inputs-"));

after(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("buildModuleLinkInputs", () => {
  it("preserves source ordering while discovering sorted and transitive style imports", () => {
    const projectDirectory = join(temporaryRoot, "style-discovery");
    const sourceFilePath = join(projectDirectory, "src", "index.ts");
    const firstStyleFilePath = join(projectDirectory, "styles", "a.css");
    const secondStyleFilePath = join(projectDirectory, "styles", "z.css");
    const nestedStyleFilePath = join(projectDirectory, "styles", "nested.css");
    const sourceExternalStyleFilePath = join(projectDirectory, "styles", "source-external.css");
    const nestedExternalStyleFilePath = join(projectDirectory, "styles", "nested-external.css");
    mkdirSync(join(projectDirectory, "src"), { recursive: true });
    mkdirSync(join(projectDirectory, "styles"), { recursive: true });
    writeFileSync(
      sourceFilePath,
      'import "../styles/z.css";\nimport "../styles/a.css";\nimport "source-external";\nexport { missing } from "./missing.js";\n',
    );
    writeFileSync(firstStyleFilePath, '@import "./nested.css";\n');
    writeFileSync(secondStyleFilePath, ".second {}\n");
    writeFileSync(nestedStyleFilePath, '@import "./broken.css";\n@import "nested-external";\n');
    writeFileSync(sourceExternalStyleFilePath, ".source-external {}\n");
    writeFileSync(nestedExternalStyleFilePath, ".nested-external {}\n");

    const resolvedPaths = new Map<string, string>([
      [`${sourceFilePath}:../styles/a.css`, firstStyleFilePath],
      [`${sourceFilePath}:../styles/z.css`, secondStyleFilePath],
      [`${sourceFilePath}:source-external`, sourceExternalStyleFilePath],
      [`${firstStyleFilePath}:./nested.css`, nestedStyleFilePath],
      [`${nestedStyleFilePath}:nested-external`, nestedExternalStyleFilePath],
    ]);
    const result = buildModuleLinkInputs({
      files: [{ index: 0, path: sourceFilePath }],
      parsedModules: [parseSourceFile(sourceFilePath)],
      resolvedEntries: {
        productionEntries: [sourceFilePath],
        testEntries: [],
        alwaysUsedFiles: [],
      },
      gitIgnoredFilePaths: new Set([nestedStyleFilePath]),
      resolveModule: (specifier, fromFilePath) => {
        const resolvedPath = resolvedPaths.get(`${fromFilePath}:${specifier}`);
        if (!resolvedPath) throw new Error(`could not resolve ${specifier}`);
        return {
          resolvedPath,
          isExternal: specifier === "source-external" || specifier === "nested-external",
          packageName: undefined,
        };
      },
    });

    assert.deepEqual(
      result.graphInputs.map((graphInput) => graphInput.fileId),
      [
        sourceFilePath,
        firstStyleFilePath,
        secondStyleFilePath,
        nestedStyleFilePath,
        nestedExternalStyleFilePath,
      ].map((filePath, index) => ({ index, path: filePath })),
    );
    assert.equal(result.graphInputs[0].isEntryPoint, true);
    assert.equal(result.graphInputs[3].isGitIgnored, true);
    assert.deepEqual(
      result.errors.map((error) => ({ message: error.message, path: error.path })),
      [
        {
          message: 'moduleResolver.resolveModule threw on specifier "./missing.js"',
          path: sourceFilePath,
        },
        {
          message: 'moduleResolver.resolveModule threw on style import "./broken.css"',
          path: nestedStyleFilePath,
        },
      ],
    );
  });
});
