import { describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "../src/index.js";
import { createOxlintConfig } from "../src/runners/oxlint/config.js";

const buildProject = (overrides: Partial<ProjectInfo> = {}): ProjectInfo => ({
  rootDirectory: "/tmp/project",
  projectName: "project",
  reactVersion: "^19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "react-native",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: true,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 0,
  ...overrides,
});

describe("createOxlintConfig settings", () => {
  it("forwards the detected @shopify/flash-list major version", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        shopifyFlashListVersion: "^2.0.0",
        shopifyFlashListMajorVersion: 2,
      }),
    });

    expect(config.settings["react-doctor"].shopifyFlashListMajorVersion).toBe(2);
  });

  it("omits the FlashList setting when the dependency is absent or unparseable", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject(),
    });

    expect(config.settings["react-doctor"]).not.toHaveProperty("shopifyFlashListMajorVersion");
  });

  it("never registers security scan rules (they run as a core environment check)", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({ framework: "vite", hasReactNativeWorkspace: false }),
    });

    expect(config.rules).not.toHaveProperty("react-doctor/artifact-secret-leak");
    expect(config.rules).not.toHaveProperty("react-doctor/raw-sql-injection-risk");
  });

  it("excludes security scan rules even when severity controls opt them in", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({ framework: "vite", hasReactNativeWorkspace: false }),
      severityControls: {
        rules: {
          "react-doctor/artifact-secret-leak": "error",
          "react-doctor/raw-sql-injection-risk": "error",
        },
      },
    });

    expect(config.rules).not.toHaveProperty("react-doctor/artifact-secret-leak");
    expect(config.rules).not.toHaveProperty("react-doctor/raw-sql-injection-risk");
  });

  const hasReactHooksJsEntry = (config: ReturnType<typeof createOxlintConfig>): boolean =>
    config.jsPlugins.some(
      (entry) => typeof entry === "object" && "name" in entry && entry.name === "react-hooks-js",
    );

  it("registers the react-hooks-js plugin + compiler rules when React Compiler is present", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({ hasReactCompiler: true }),
    });

    expect(hasReactHooksJsEntry(config)).toBe(true);
    expect(Object.keys(config.rules).some((ruleKey) => ruleKey.startsWith("react-hooks-js/"))).toBe(
      true,
    );
  });

  it("drops the react-hooks-js plugin + compiler rules under disableReactHooksJsPlugin (the load-failure fallback)", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({ hasReactCompiler: true }),
      disableReactHooksJsPlugin: true,
    });

    expect(hasReactHooksJsEntry(config)).toBe(false);
    expect(Object.keys(config.rules).some((ruleKey) => ruleKey.startsWith("react-hooks-js/"))).toBe(
      false,
    );
    // The curated react-doctor rules still register — only the optional
    // React Compiler frontend is dropped.
    expect(config.jsPlugins).toContain("/tmp/plugin.js");
  });
});
