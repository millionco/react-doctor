import { describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "../src/index.js";
import { createOxlintConfig } from "../src/runners/oxlint/config.js";

const project: ProjectInfo = {
  rootDirectory: "/tmp/project",
  projectName: "project",
  reactVersion: "^19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  zustandVersion: null,
  zustandMajorVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasReactCompilerLintPlugin: false,
  hasTanStackQuery: false,
  tanstackQueryVersion: null,
  mobxVersion: null,
  styledComponentsVersion: null,
  valtioVersion: null,
  valtioMajorVersion: null,
  hasThree: false,
  threeVersion: null,
  threeRelease: null,
  hasReactThreeFiber: false,
  reactThreeFiberVersion: null,
  reactThreeFiberMajorVersion: null,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 0,
};

describe("createOxlintConfig type-aware linting", () => {
  it("pins `options.typeAware` off so an extended user config cannot demand tsgolint", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project,
      extendsPaths: ["/tmp/project/.oxlintrc.json"],
    });

    expect(config.extends).toEqual(["/tmp/project/.oxlintrc.json"]);
    expect(config.options).toEqual({ typeAware: false });
  });

  it("emits the option even without extends so every generated config hashes alike", () => {
    const config = createOxlintConfig({ pluginPath: "/tmp/plugin.js", project });

    expect(config.options).toEqual({ typeAware: false });
  });
});
