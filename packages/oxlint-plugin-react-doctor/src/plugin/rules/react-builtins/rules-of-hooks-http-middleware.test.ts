import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const entry = `import { useCors } from "lib/adapter";
export default async (request, response) => { await useCors(request, response); };`;

const adapter = `import cors from "cors";
function asPromise(middleware) {
  return (request, response) => new Promise((resolve, reject) => {
    middleware(request, response, (error) => error instanceof Error ? reject(error) : resolve(error));
  });
}
export const useCors = asPromise(cors());`;

let workspace: string;

const write = (relativePath: string, contents: string): string => {
  const filename = path.join(workspace, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
  return filename;
};

const resetCrossFileState = (): void => {
  __clearParseSourceFileCacheForTests();
  resetManifestCaches();
  resetCrossFileExportCaches();
  resetTsconfigAliasCaches();
};

const checkEntry = () => {
  const filename = write("app/pages/api/probe.js", entry);
  const result = runRule(rulesOfHooks, entry, { filename });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "rd-http-adapter-"));
  resetCrossFileState();
  write("app/package.json", '{ "dependencies": { "next": "14.0.3", "cors": "^2.8.5" } }');
  write("app/jsconfig.json", '{ "compilerOptions": { "baseUrl": "." } }');
  write("app/lib/adapter.js", adapter);
});

afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

describe("rules-of-hooks — HTTP callback adapter", () => {
  it("recognizes the stock wrapped middleware and fingerprints the lookup", () => {
    const configuration = write("app/next.config.js", "module.exports = {};");
    const filename = write("app/pages/api/probe.js", entry);
    expect(checkEntry()).toEqual([]);
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: entry,
      ruleIds: ["rules-of-hooks"],
    });
    expect(trace).not.toBeNull();
    for (const dependency of [
      configuration,
      path.join(workspace, "app", "jsconfig.json"),
      path.join(workspace, "app", "lib", "adapter.js"),
      path.join(workspace, "app", "package.json"),
      path.join(workspace, "package.json"),
    ]) {
      expect(trace?.contentPaths.has(dependency)).toBe(true);
    }
    expect(trace?.existencePaths.has(path.join(workspace, "app", "babel.config.js"))).toBe(true);
    expect(trace?.existencePaths.has(path.join(workspace, "pnpm-workspace.yaml"))).toBe(true);
  });

  it.each([
    [
      "app/next.config.js",
      "module.exports = { webpack(config) { config.resolve.alias.cors = replacement; return config; } };",
    ],
    [
      "next.config.js",
      "module.exports = { webpack(config) { config.resolve.alias.cors = replacement; return config; } };",
    ],
    ["app/babel.config.js", "module.exports = { plugins: [rewriteImports] };"],
    ["package.json", '{ "pnpm": { "overrides": { "cors": "link:./local-cors" } } }'],
    ["app/.npmrc", "pnpmfile=./local-dependency-hooks.cjs"],
  ])("retains the warning with a provider redirection in %s", (filename, source) => {
    expect(checkEntry()).toEqual([]);
    write(filename, source);
    resetCrossFileState();
    expect(checkEntry()).toHaveLength(1);
  });

  it("retains the warning when the global Promise is replaced", () => {
    write(
      "app/lib/adapter.js",
      `import { useState } from "react";
globalThis.Promise = class extends Promise {
  constructor(executor) { useState(0); super(executor); }
};
${adapter}`,
    );
    expect(checkEntry()).toHaveLength(1);
  });
});
