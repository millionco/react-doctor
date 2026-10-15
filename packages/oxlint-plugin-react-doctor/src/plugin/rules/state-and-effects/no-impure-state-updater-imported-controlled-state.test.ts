import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  createControlledStatePackageFixture,
  CONTROLLED_STATE_ESM_HOOK as ESM_HOOK,
  CONTROLLED_STATE_COMMONJS_HOOK as COMMONJS_HOOK,
  CONTROLLED_STATE_COMMONJS_ENTRY as COMMONJS_ENTRY,
} from "../../../test-utils/create-controlled-state-package-fixture.js";
import type { ControlledPackageFixture } from "../../../test-utils/create-controlled-state-package-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { noImpureStateUpdater } from "./no-impure-state-updater.js";

let temporaryDirectory: string;

const resetFixtureCaches = (): void => {
  resetManifestCaches();
  resetModuleResolutionCaches();
  resetCrossFileExportCaches();
  resetTsconfigAliasCaches();
  __clearParseSourceFileCacheForTests();
};

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-controlled-setter-"));
  resetFixtureCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, source: string): string => {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
  return filename;
};

const createPackage = (fixture: ControlledPackageFixture = {}): void =>
  createControlledStatePackageFixture(temporaryDirectory, fixture);

const runConsumer = (
  body: string,
  setup = "",
  imports = `import { useControlledState } from "@rc-component/util";`,
) =>
  runRule(
    noImpureStateUpdater,
    `${imports} ${setup}
    const Panel = () => { const [value, updateValue] = useControlledState(0, undefined); ${body} return null; };`,
    { filename: path.join(temporaryDirectory, "panel.tsx") },
  );

const expectCount = (body: string, expected: number, setup = "", imports?: string): void => {
  const result = runConsumer(body, setup, imports);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expected);
};

describe("no-impure-state-updater installed controlled setters", () => {
  it("reports a proven native imported setter without local useState", () => {
    createPackage();
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      1,
    );
  });

  it("reports through a renamed canonical named import", () => {
    createPackage();
    const result = runRule(
      noImpureStateUpdater,
      `import { useControlledState as readValue } from "@rc-component/util";
      const Panel = () => { const [value, updateValue] = readValue(0);
        updateValue(previous => { queueMicrotask(() => notify()); return previous; }); return null; };`,
      { filename: path.join(temporaryDirectory, "panel.tsx") },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["an unrelated module", `import { useControlledState } from "other-control";`],
    ["a type-only import", `import type { useControlledState } from "@rc-component/util";`],
    ["a same-named local", `const useControlledState = () => [0, callback => callback(0)];`],
  ])("rejects %s", (_description, imports) => {
    createPackage();
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
      "",
      imports,
    );
  });

  it("keeps pure updaters quiet", () => {
    createPackage();
    expectCount(`updateValue(previous => previous + 1);`, 0);
  });

  it("reports through an immutable setter alias", () => {
    createPackage();
    expectCount(
      `const dispatch = updateValue; dispatch(previous => { queueMicrotask(() => notify()); return previous; });`,
      1,
    );
  });

  it.each([
    ["a missing dependency", { version: "1.13.0" }],
    ["another version", { version: "1.14.0" }],
    ["a prerelease", { version: "1.13.0-beta.1" }],
    ["a renamed package", { name: "other-control" }],
    ["conditional exports", { exports: { import: "./es/index.js", require: "./lib/index.js" } }],
    ["browser routing", { browser: "./replacement.js" }],
    ["native routing", { "react-native": "./replacement.js" }],
    ["module type routing", { type: "module" }],
  ])("rejects %s", (description, packageOverrides) => {
    createPackage({ packageOverrides });
    if (description === "a missing dependency")
      fs.rmSync(path.join(temporaryDirectory, "node_modules"), { recursive: true });
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });

  it.each([
    [
      "native provider replacement",
      `import React from "react"; React.useState = () => [0, callback => callback(0)];`,
    ],
    [
      "provider alias replacement",
      `import React from "react"; const Provider = React; Provider.useState = () => [0, callback => callback(0)];`,
    ],
    [
      "provider Object.assign",
      `import React from "react"; Object.assign(React, { useState: () => [0, callback => callback(0)] });`,
    ],
    ["provider escape", `import React from "react"; mutate(React);`],
    [
      "a namespace default projection",
      `import * as Provider from "react"; Provider.default.useState = () => [0, callback => callback(0)];`,
    ],
    ["a CJS consumer loader", `const Provider = require("react");`],
    ["an opaque eval", `eval(source);`],
  ])("rejects %s", (_description, setup) => {
    createPackage();
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
      setup,
    );
  });

  it.each([
    ["provider metadata", `import React from "react"; React.useState.description = "state";`],
    [
      "provider computed-key read",
      `import React from "react"; ({ [React.useState]: metadata } = {});`,
    ],
    ["provider default RHS read", `import React from "react"; [metadata = React.useState] = [];`],
    ["setter metadata", "", `updateValue.description = "state";`],
    ["setter computed-key read", "", `({ [updateValue]: metadata } = {});`],
    ["setter default RHS read", "", `[metadata = updateValue] = [];`],
  ])("preserves %s", (_description, setup, prefix = "") => {
    createPackage();
    expectCount(
      `${prefix} updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      1,
      setup,
    );
  });

  it.each([
    [
      "a dead branch",
      `updateValue(previous => { if (false) queueMicrotask(() => notify()); return previous; });`,
    ],
    [
      "zero",
      `updateValue(previous => { if (0) queueMicrotask(() => notify()); return previous; });`,
    ],
    [
      "zero BigInt",
      `updateValue(previous => { if (0n) queueMicrotask(() => notify()); return previous; });`,
    ],
    [
      "boolean negation",
      `updateValue(previous => { if (!true) queueMicrotask(() => notify()); return previous; });`,
    ],
    [
      "a closure condition",
      `updateValue(previous => { if (enabled) queueMicrotask(() => notify()); return previous; });`,
    ],
    [
      "a dead caller",
      `if (false) updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
    ],
    [
      "a nested uncalled function",
      `updateValue(previous => { const later = () => queueMicrotask(() => notify()); return previous; });`,
    ],
    [
      "an unsupported nested array callback",
      `updateValue(previous => { [0].map(() => queueMicrotask(() => notify())); return previous; });`,
    ],
    [
      "an unconstructed class field",
      `updateValue(previous => { class Unused { value = queueMicrotask(() => notify()); } return previous; });`,
    ],
    [
      "an unsupported static class field",
      `updateValue(previous => { class Unused { static value = queueMicrotask(() => notify()); } return previous; });`,
    ],
    [
      "an async updater",
      `updateValue(async previous => { queueMicrotask(() => notify()); return previous; });`,
    ],
    [
      "an updater passed by name",
      `const change = previous => { queueMicrotask(() => notify()); return previous; }; updateValue(change);`,
    ],
    [
      "an unreachable operation",
      `updateValue(previous => { return previous; queueMicrotask(() => notify()); });`,
    ],
    [
      "a replaced setter",
      `updateValue = callback => callback(value); updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
    ],
    [
      "a replaced alias",
      `let dispatch = updateValue; dispatch = callback => callback(value); dispatch(previous => { queueMicrotask(() => notify()); return previous; });`,
    ],
    [
      "a default target replacement",
      `[updateValue = callback => callback(value)] = []; updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
    ],
  ])("keeps %s quiet", (_description, body) => {
    createPackage();
    expectCount(body, 0);
  });

  it("does not let an earlier unsupported operation hide a later unconditional operation", () => {
    createPackage();
    expectCount(
      `updateValue(previous => { if (false) queueMicrotask(() => notify()); localStorage.setItem("key", "value"); return previous; });`,
      1,
    );
  });

  it.each([
    [
      "wrapped ESM setter",
      {
        esmHook: ESM_HOOK.replace(
          "return [currentValue, updateValue]",
          "return [currentValue, callback => updateValue(callback)]",
        ),
      },
    ],
    [
      "wrapped CJS setter",
      {
        commonjsHook: COMMONJS_HOOK.replace(
          "return [currentValue, updateValue]",
          "return [currentValue, callback => updateValue(callback)]",
        ),
      },
    ],
    [
      "wrong CJS provider",
      { commonjsHook: COMMONJS_HOOK.replace('require("react")', 'require("other")') },
    ],
    [
      "CJS API replacement",
      {
        commonjsHook: COMMONJS_HOOK.replace(
          "const controlledState",
          "stateProvider.useState = () => [0, callback => callback(0)]; const controlledState",
        ),
      },
    ],
    [
      "effectful CJS sequence",
      {
        commonjsHook: COMMONJS_HOOK.replace(
          "(0, stateProvider.useState)",
          "(touch(), stateProvider.useState)",
        ),
      },
    ],
    [
      "unknown interop",
      {
        commonjsEntry: COMMONJS_ENTRY.replace(
          "moduleValue && moduleValue.__esModule ? moduleValue : { default: moduleValue }",
          "transform(moduleValue)",
        ),
      },
    ],
    ["a missing CJS route", { main: "./lib/missing" }],
    ["a missing ESM route", { module: "./es/missing" }],
  ])("rejects %s", (_description, fixture) => {
    createPackage(fixture);
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });

  it.each([
    [
      "an unresolved package alias",
      { compilerOptions: { paths: { "@rc-component/util": ["missing"] } } },
    ],
    ["an unresolved React alias", { compilerOptions: { paths: { react: ["missing"] } } }],
    ["an unsupported extends route", { extends: "./missing-config.json" }],
    [
      "an unsupported plugin route",
      { compilerOptions: { plugins: [{ name: "custom-provider" }] } },
    ],
  ])("rejects %s", (_description, configuration) => {
    createPackage();
    writeFile("tsconfig.json", JSON.stringify(configuration));
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });

  it("records actual source and missing/config probes through the same adapter", () => {
    createPackage();
    const filename = writeFile(
      "panel.tsx",
      `import { useControlledState } from "@rc-component/util";
      const Panel = () => { const [value, updateValue] = useControlledState(0);
        updateValue(previous => { queueMicrotask(() => notify()); return previous; }); return null; };`,
    );
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      1,
    );
    const result = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: fs.readFileSync(filename, "utf8"),
      ruleIds: ["no-impure-state-updater"],
    });
    if (!result) throw new Error("Expected bounded dependency probes");
    const contentPaths = result.contentPaths;
    for (const file of [
      "package.json",
      "tsconfig.json",
      "jsconfig.json",
      "node_modules/@rc-component/util/package.json",
      "node_modules/@rc-component/util/lib/index.js",
      "node_modules/@rc-component/util/lib/bound-state.js",
      "node_modules/@rc-component/util/es/index.js",
      "node_modules/@rc-component/util/es/bound-state.js",
    ]) {
      expect(contentPaths.has(path.join(temporaryDirectory, file))).toBe(true);
    }
    expect(
      result.existencePaths.has(
        path.join(temporaryDirectory, "node_modules/@rc-component/util/lib/bound-state"),
      ),
    ).toBe(true);
  });
  it.each([
    ["a native package override", { overrides: { react: "other-provider" } }],
    [
      "a versioned package override",
      { overrides: { "@rc-component/util@1.13.0": "other-control" } },
    ],
    ["a parent package override", { overrides: { owner: { react: "other-provider" } } }],
    ["a wildcard resolution", { resolutions: { "**/react": "other-provider" } }],
    [
      "a pnpm patch",
      { pnpm: { patchedDependencies: { "@rc-component/util@1.13.0": "patch.diff" } } },
    ],
    ["a React dependency alias", { dependencies: { react: "npm:other-provider@1.0.0" } }],
    ["a linked controlled package", { dependencies: { "@rc-component/util": "link:../control" } }],
  ])("rejects %s", (_description, consumerManifest) => {
    createPackage({ consumerManifest });
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });

  it("preserves unrelated dependency overrides and tsconfig paths", () => {
    createPackage({ consumerManifest: { overrides: { "other-library": "1.0.0" } } });
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@local/*": ["src/*"] } } }),
    );
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      1,
    );
  });

  it("rejects an ancestor package override and records that manifest", () => {
    createPackage();
    const parentManifest = path.join(temporaryDirectory, "package.json");
    fs.writeFileSync(parentManifest, JSON.stringify({ overrides: { react: "other-provider" } }));
    const filename = writeFile("workspace/package.json", JSON.stringify({ name: "workspace" }));
    const consumerFile = path.join(path.dirname(filename), "panel.tsx");
    const source = `import { useControlledState } from "@rc-component/util";
      const Panel = () => { const [value, updateValue] = useControlledState(0);
        updateValue(previous => { queueMicrotask(() => notify()); return previous; }); return null; };`;
    const result = runRule(noImpureStateUpdater, source, { filename: consumerFile });
    expect(result.diagnostics).toEqual([]);
    const probes = collectCrossFileDependencyProbes({
      absoluteFilePath: consumerFile,
      sourceText: source,
      ruleIds: ["no-impure-state-updater"],
    });
    expect(probes?.contentPaths.has(parentManifest)).toBe(true);
  });

  it("rejects malformed nearest configuration", () => {
    createPackage();
    writeFile("tsconfig.json", "{broken");
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });

  it("does not select a TypeScript shadow for the CommonJS JavaScript file", () => {
    createPackage({
      commonjsHook: COMMONJS_HOOK.replace(
        "return [currentValue, updateValue]",
        "return [currentValue, callback => callback(localValue)]",
      ),
    });
    writeFile("node_modules/@rc-component/util/lib/bound-state.ts", COMMONJS_HOOK);
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });

  it("rejects an extensionless file that changes Node's route", () => {
    createPackage();
    writeFile("node_modules/@rc-component/util/lib/bound-state", "module.exports = replacement;");
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });

  it.each([
    [
      "an effectful getter",
      COMMONJS_ENTRY.replace(
        "get: () => stateHook.default",
        "get: () => { touch(); return stateHook.default; }",
      ),
    ],
    ["a reassigned interop binding", COMMONJS_ENTRY + " projectDefault = transform;"],
    ["a replaced namespace", COMMONJS_ENTRY + " stateHook = replacement;"],
    ["an escaped namespace", COMMONJS_ENTRY + " mutate(stateHook);"],
    ["an unknown export write", COMMONJS_ENTRY + " exports[exportName] = replacement;"],
  ])("rejects %s", (_description, commonjsEntry) => {
    createPackage({ commonjsEntry });
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });

  it.each([
    ["a replaced native setter", "updateValue = replacement;"],
    ["a default-target setter replacement", "[updateValue = replacement] = [];"],
    ["a conditional return", "if (controlled) return [currentValue, replacement];"],
    ["an arguments-dependent source", "const supplied = arguments;"],
  ])("rejects %s in either installed entry", (_description, injectedStatement) => {
    const insert = (source: string): string =>
      source.replace(
        "return [currentValue, updateValue]",
        `${injectedStatement} return [currentValue, updateValue]`,
      );
    for (const fixture of [
      { esmHook: insert(ESM_HOOK) },
      { commonjsHook: insert(COMMONJS_HOOK) },
    ]) {
      createPackage(fixture);
      resetFixtureCaches();
      expectCount(
        `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
        0,
      );
    }
  });

  it.each([
    ["native setter metadata", 'updateValue.description = "state";'],
    ["native setter computed-key read", "({ [updateValue]: metadata } = {});"],
    ["native setter default RHS read", "[metadata = updateValue] = [];"],
  ])("preserves %s in both installed entries", (_description, injectedStatement) => {
    const insert = (source: string): string =>
      source.replace(
        "return [currentValue, updateValue]",
        `${injectedStatement} return [currentValue, updateValue]`,
      );
    createPackage({ esmHook: insert(ESM_HOOK), commonjsHook: insert(COMMONJS_HOOK) });
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      1,
    );
  });

  it("reproves missing, changed helper, and changed configuration inputs after cache resets", () => {
    createPackage();
    const packageDirectory = path.join(temporaryDirectory, "node_modules");
    fs.rmSync(packageDirectory, { recursive: true });
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
    createPackage();
    resetFixtureCaches();
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      1,
    );
    createPackage({
      esmHook: ESM_HOOK.replace(
        "return [currentValue, updateValue]",
        "return [currentValue, replacement]",
      ),
    });
    resetFixtureCaches();
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
    createPackage();
    writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { react: ["replacement"] } } }),
    );
    resetFixtureCaches();
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });
  it.each([
    ["the controlled package", { "@rc-component/util": "./replacement.js" }],
    ["the native provider", { react: "./replacement.js" }],
  ])("rejects a caller browser mapping of %s", (_description, browser) => {
    createPackage({ consumerManifest: { browser } });
    writeFile(
      "replacement.js",
      `export const useControlledState = () => [0, callback => callback(0)];`,
    );
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });

  it("preserves unrelated browser mappings", () => {
    createPackage({ consumerManifest: { browser: { "other-library": "./replacement.js" } } });
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      1,
    );
  });

  it.each([
    [
      "the default hook",
      `Object.defineProperty(exports, "default", { value: () => [0, callback => callback(0)] });`,
    ],
    ["the module marker", `Object.defineProperty(exports, "__esModule", { value: false });`],
  ])("rejects a second helper descriptor for %s", (_description, replacement) => {
    createPackage({ commonjsHook: COMMONJS_HOOK + replacement });
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });
  it.each([
    ["a native dependency alias", { dependencies: { react: "npm:other-provider@1.0.0" } }],
    ["a linked native dependency", { dependencies: { react: "file:./provider" } }],
    ["a native override", { overrides: { react: "other-provider" } }],
  ])("rejects %s in the installed manifest", (_description, packageOverrides) => {
    createPackage({ packageOverrides });
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });

  it("preserves unrelated installed overrides", () => {
    createPackage({ packageOverrides: { overrides: { "other-library": "1.0.0" } } });
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      1,
    );
  });
  it.each([
    [
      "a dead namespace initializer",
      {
        commonjsEntry: COMMONJS_ENTRY.replace(
          'const stateHook = projectDefault(require("./bound-state"));',
          'if (false) { var stateHook = projectDefault(require("./bound-state")); }',
        ),
      },
    ],
    [
      "a conditional namespace initializer",
      {
        commonjsEntry: COMMONJS_ENTRY.replace(
          'const stateHook = projectDefault(require("./bound-state"));',
          'if (condition) { var stateHook = projectDefault(require("./bound-state")); }',
        ),
      },
    ],
    [
      "a dead interop initializer",
      {
        commonjsEntry: COMMONJS_ENTRY.replace(
          "const projectDefault = moduleValue => moduleValue && moduleValue.__esModule ? moduleValue : { default: moduleValue };",
          "if (false) { var projectDefault = moduleValue => moduleValue && moduleValue.__esModule ? moduleValue : { default: moduleValue }; }",
        ),
      },
    ],
    [
      "a dead helper initializer",
      {
        commonjsHook: COMMONJS_HOOK.replace(
          "const controlledState =",
          "if (false) { var controlledState =",
        ).replace("}; exports.default =", "}; } exports.default ="),
      },
    ],
    [
      "a conditional helper initializer",
      {
        commonjsHook: COMMONJS_HOOK.replace(
          "const controlledState =",
          "if (condition) { var controlledState =",
        ).replace("}; exports.default =", "}; } exports.default ="),
      },
    ],
  ])("rejects %s", (_description, fixture) => {
    createPackage(fixture);
    expectCount(
      `updateValue(previous => { queueMicrotask(() => notify()); return previous; });`,
      0,
    );
  });
});
