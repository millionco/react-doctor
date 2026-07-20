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
  zustandVersion: null,
  zustandMajorVersion: null,
  framework: "react-native",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasReactCompilerLintPlugin: false,
  hasTanStackQuery: false,
  valtioVersion: null,
  valtioMajorVersion: null,
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

const viteWebProject = buildProject({ framework: "vite", hasReactNativeWorkspace: false });

describe("createOxlintConfig settings", () => {
  it("enables the Valtio rule only when the project declares Valtio", () => {
    const withoutValtio = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
    });
    const withValtio = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        valtioVersion: "^2.1.4",
        valtioMajorVersion: 2,
      }),
    });

    expect(withoutValtio.rules).not.toHaveProperty("react-doctor/valtio-no-proxy-read-in-render");
    expect(withValtio.rules["react-doctor/valtio-no-proxy-read-in-render"]).toBe("warn");
  });

  it("keeps the Valtio rule disabled when its declared version is unparseable", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        valtioVersion: "workspace:*",
        valtioMajorVersion: null,
      }),
    });

    expect(config.rules).not.toHaveProperty("react-doctor/valtio-no-proxy-read-in-render");
  });

  it("registers the Zustand rule only for supported Zustand projects", () => {
    const ruleKey = "react-doctor/zustand-no-whole-store-destructure";
    const noZustand = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({ framework: "vite", hasReactNativeWorkspace: false }),
    });
    const futureZustand = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        zustandVersion: "^6.0.0",
        zustandMajorVersion: 6,
      }),
    });
    const zustand1 = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        zustandVersion: "^1.0.0",
        zustandMajorVersion: 1,
      }),
    });
    const zustand5 = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        zustandVersion: "^5.0.8",
        zustandMajorVersion: 5,
      }),
    });

    expect(noZustand.rules).not.toHaveProperty(ruleKey);
    expect(futureZustand.rules).not.toHaveProperty(ruleKey);
    expect(zustand1.rules[ruleKey]).toBe("warn");
    expect(zustand5.rules[ruleKey]).toBe("warn");
  });

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
      project: viteWebProject,
    });

    expect(config.rules).not.toHaveProperty("react-doctor/artifact-secret-leak");
    expect(config.rules).not.toHaveProperty("react-doctor/raw-sql-injection-risk");
  });

  it("registers Remotion rules only for Remotion v4 or newer", () => {
    const remotionThreeConfig = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        hasRemotion: true,
        remotionVersion: "^3.3.0",
        remotionMajorVersion: 3,
      }),
    });
    const remotionFourConfig = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        hasRemotion: true,
        remotionVersion: "^4.0.0",
        remotionMajorVersion: 4,
      }),
    });
    const getRemotionRuleNames = (config: ReturnType<typeof createOxlintConfig>): string[] =>
      Object.keys(config.rules).filter((ruleName) => ruleName.startsWith("react-doctor/remotion-"));

    expect(getRemotionRuleNames(remotionThreeConfig)).toEqual([]);
    expect(getRemotionRuleNames(remotionFourConfig)).toHaveLength(9);
  });

  it("excludes security scan rules even when severity controls opt them in", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
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

  it("keeps compatibility lint rules without enabling transform-only rules", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({ hasReactCompilerLintPlugin: true }),
    });

    expect(hasReactHooksJsEntry(config)).toBe(true);
    expect(Object.keys(config.rules).some((ruleKey) => ruleKey.startsWith("react-hooks-js/"))).toBe(
      true,
    );
    expect(config.rules).not.toHaveProperty("react-doctor/react-compiler-no-manual-memoization");
  });

  it("keeps opt-out (defaultEnabled: false) rules off by default", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
    });

    expect(config.rules).not.toHaveProperty("react-doctor/forbid-component-props");
  });

  it("does not let a category-level severity flip an opt-out rule on", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      severityControls: { categories: { Maintainability: "warn" } },
    });

    expect(config.rules).not.toHaveProperty("react-doctor/forbid-component-props");
  });

  it("category-level severity still re-stamps already-enabled rules", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      severityControls: { categories: { Maintainability: "error" } },
    });

    expect(config.rules["react-doctor/no-multi-comp"]).toBe("error");
  });

  it("a per-rule severity opts an opt-out rule in", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      severityControls: { rules: { "react-doctor/forbid-component-props": "warn" } },
    });

    expect(config.rules["react-doctor/forbid-component-props"]).toBe("warn");
  });

  it("a legacy alias severity opts an opt-out rule in", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      severityControls: { rules: { "react/forbid-component-props": "warn" } },
    });

    expect(config.rules["react-doctor/forbid-component-props"]).toBe("warn");
  });

  it("gates fresh Zustand selector diagnostics to major version 5", () => {
    const supportedConfig = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        zustandVersion: "^5.0.0",
        zustandMajorVersion: 5,
      }),
    });
    expect(supportedConfig.rules["react-doctor/zustand-no-fresh-selector-result"]).toBe("error");

    for (const project of [
      buildProject({ framework: "vite", hasReactNativeWorkspace: false }),
      buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        zustandVersion: "^4.0.0",
        zustandMajorVersion: 4,
      }),
      buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        zustandVersion: "^6.0.0",
        zustandMajorVersion: 6,
      }),
    ]) {
      const config = createOxlintConfig({ pluginPath: "/tmp/plugin.js", project });
      expect(config.rules).not.toHaveProperty("react-doctor/zustand-no-fresh-selector-result");
    }
  });

  it("gates Zustand initialization and mutation diagnostics to supported major versions", () => {
    for (const zustandMajorVersion of [1, 2, 3, 4, 5]) {
      const config = createOxlintConfig({
        pluginPath: "/tmp/plugin.js",
        project: buildProject({
          framework: "vite",
          hasReactNativeWorkspace: false,
          zustandVersion: `^${zustandMajorVersion}.0.0`,
          zustandMajorVersion,
        }),
      });
      expect(config.rules["react-doctor/zustand-no-get-during-initialization"]).toBe("error");
      expect(config.rules["react-doctor/zustand-no-mutating-state"]).toBe("error");
    }

    for (const project of [
      buildProject({ framework: "vite", hasReactNativeWorkspace: false }),
      buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        zustandVersion: "workspace:*",
        zustandMajorVersion: null,
      }),
      buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        zustandVersion: "^6.0.0",
        zustandMajorVersion: 6,
      }),
    ]) {
      const config = createOxlintConfig({ pluginPath: "/tmp/plugin.js", project });
      expect(config.rules).not.toHaveProperty("react-doctor/zustand-no-get-during-initialization");
      expect(config.rules).not.toHaveProperty("react-doctor/zustand-no-mutating-state");
    }
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
