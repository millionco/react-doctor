import { describe, expect, it } from "vite-plus/test";
import type { ProjectInfo, RuleSeverityOverride } from "../src/index.js";
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
const tailwindViteWebProject = buildProject({
  framework: "vite",
  hasReactNativeWorkspace: false,
  tailwindVersion: "^4.0.0",
});

describe("createOxlintConfig customRulesOnly", () => {
  it.each<[RuleSeverityOverride]>([["warn"], ["error"]])(
    "enables only explicitly selected ported rules at %s severity",
    (severity) => {
      const config = createOxlintConfig({
        pluginPath: "/tmp/plugin.js",
        project: viteWebProject,
        customRulesOnly: true,
        severityControls: {
          rules: {
            "react-doctor/jsx-key": severity,
            "jsx-a11y/alt-text": severity,
            "effect/no-derived-state": severity,
          },
          categories: { Accessibility: "error", Bugs: "error" },
        },
      });

      expect(config.rules["react-doctor/jsx-key"]).toBe(severity);
      expect(config.rules["react-doctor/alt-text"]).toBe(severity);
      expect(config.rules["react-doctor/no-derived-state"]).toBe(severity);
      expect(config.rules).not.toHaveProperty("react-doctor/no-danger");
      expect(config.rules).not.toHaveProperty("react-doctor/anchor-is-valid");
      expect(config.rules).not.toHaveProperty("react-doctor/no-chain-state-updates");
    },
  );

  it("keeps ported rules off without a rule override", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      customRulesOnly: true,
      severityControls: { categories: { Accessibility: "error", Bugs: "error" } },
    });

    expect(config.rules).not.toHaveProperty("react-doctor/alt-text");
    expect(config.rules).not.toHaveProperty("react-doctor/jsx-key");
  });

  it("keeps explicit off settings and canonical rule precedence", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      customRulesOnly: true,
      severityControls: {
        rules: {
          "react-doctor/alt-text": "off",
          "jsx-a11y/alt-text": "error",
          "react/jsx-key": "off",
        },
        categories: { Accessibility: "error", Bugs: "error" },
      },
    });

    expect(config.rules).not.toHaveProperty("react-doctor/alt-text");
    expect(config.rules).not.toHaveProperty("react-doctor/jsx-key");
  });

  it("lets an explicit rule override a disabled category", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      customRulesOnly: true,
      severityControls: {
        rules: { "react/jsx-key": "error" },
        categories: { Bugs: "off" },
      },
    });

    expect(config.rules["react-doctor/jsx-key"]).toBe("error");
  });

  it("keeps tag exclusions for explicitly selected ported rules", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      customRulesOnly: true,
      ignoredTags: new Set(["react-jsx-only"]),
      severityControls: { rules: { "jsx-a11y/alt-text": "error" } },
    });

    expect(config.rules).not.toHaveProperty("react-doctor/alt-text");
  });

  it("keeps project requirements for explicitly selected ported rules", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "unknown",
        reactVersion: null,
        reactMajorVersion: null,
        hasReactNativeWorkspace: false,
      }),
      customRulesOnly: true,
      severityControls: { rules: { "react/jsx-key": "error" } },
    });

    expect(config.rules).not.toHaveProperty("react-doctor/jsx-key");
  });

  it("keeps React Compiler disabled when a ported rule is selected", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({ hasReactCompiler: true }),
      customRulesOnly: true,
      severityControls: {
        rules: { "react/jsx-key": "error", "react-hooks-js/void-use-memo": "error" },
      },
    });

    expect(config.rules["react-doctor/jsx-key"]).toBe("error");
    expect(Object.keys(config.rules).some((ruleKey) => ruleKey.startsWith("react-hooks-js/"))).toBe(
      false,
    );
    expect(
      config.jsPlugins.some(
        (entry) => typeof entry === "object" && entry.name === "react-hooks-js",
      ),
    ).toBe(false);
  });
});

describe("createOxlintConfig settings", () => {
  it.each<Partial<ProjectInfo>>([
    { reactVersion: "17.0.1", reactMajorVersion: 17, styledComponentsVersion: "5.3.3" },
    { reactVersion: "18.3.1", reactMajorVersion: 18 },
    { reactVersion: "19.0.0", reactMajorVersion: 19 },
    { hasReactCompiler: true },
    { hasReactNativeWorkspace: true },
    { preactVersion: "10.26.0", preactMajorVersion: 10 },
    { reactVersion: null, reactMajorVersion: null, styledComponentsVersion: undefined },
  ])("forwards discovered runtime profile facts for %j", (projectOverrides) => {
    const project = buildProject({
      framework: "vite",
      hasReactNativeWorkspace: false,
      ...projectOverrides,
    });
    const config = createOxlintConfig({ pluginPath: "/tmp/plugin.js", project });

    expect(config.settings["react-doctor"]).toMatchObject({
      framework: project.framework,
      reactVersion: project.reactVersion,
      reactMajorVersion: project.reactMajorVersion,
      styledComponentsVersion: project.styledComponentsVersion ?? null,
      preactVersion: project.preactVersion,
      preactMajorVersion: project.preactMajorVersion,
      hasReactCompiler: project.hasReactCompiler,
      hasReactNativeWorkspace: project.hasReactNativeWorkspace,
    });
  });

  it("keeps discovered profile facts authoritative over adopted settings", () => {
    const project = buildProject({
      framework: "vite",
      reactVersion: "17.0.1",
      reactMajorVersion: 17,
      styledComponentsVersion: "5.3.3",
      hasReactNativeWorkspace: false,
    });
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project,
      adoptedSettings: {
        "react-doctor": {
          reactVersion: "19.0.0",
          reactMajorVersion: 19,
          styledComponentsVersion: "6.0.0",
          preactVersion: "10.26.0",
          preactMajorVersion: 10,
          hasReactCompiler: true,
          hasReactNativeWorkspace: true,
        },
        react: { version: "16.2.0" },
      },
    });

    expect(config.settings["react-doctor"]).toMatchObject({
      reactVersion: "17.0.1",
      reactMajorVersion: 17,
      styledComponentsVersion: "5.3.3",
      preactVersion: null,
      preactMajorVersion: null,
      hasReactCompiler: false,
      hasReactNativeWorkspace: false,
    });
    expect(config.settings.react).toEqual({ version: "16.2.0" });
    expect(config.settings["react-doctor"]).not.toHaveProperty("displayName");
    expect(config.settings["react-doctor"]).not.toHaveProperty("noUnsafe");
  });

  it("uses curated behavior for faithfully ported rules", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
    });

    expect(config.settings).toMatchObject({
      "react-doctor": { portedRuleMode: "curated" },
    });
  });

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

  it("registers Three lifecycle rules without enabling Fiber rules", () => {
    const plainThree = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        hasThree: true,
        threeVersion: "^0.180.0",
        threeRelease: 180,
      }),
    });

    expect(plainThree.rules).toHaveProperty("react-doctor/three-require-renderer-cleanup");
    expect(plainThree.rules).toHaveProperty("react-doctor/three-require-render-target-cleanup");
    expect(plainThree.rules).toHaveProperty("react-doctor/three-require-postprocessing-cleanup");
    expect(plainThree.rules).not.toHaveProperty("react-doctor/r3f-cap-device-pixel-ratio");
  });

  it("forwards Three.js release capabilities for runtime postprocessing gates", () => {
    const release145 = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        hasThree: true,
        threeVersion: "^0.145.0",
        threeRelease: 145,
      }),
    });
    const release146 = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        hasThree: true,
        threeVersion: "^0.146.0",
        threeRelease: 146,
      }),
    });

    expect(release145.rules).toHaveProperty("react-doctor/three-require-postprocessing-cleanup");
    expect(release146.rules).toHaveProperty("react-doctor/three-require-postprocessing-cleanup");
    expect(release145.settings["react-doctor"].capabilities).toContain("three:145");
    expect(release145.settings["react-doctor"].capabilities).not.toContain("three:146");
    expect(release146.settings["react-doctor"].capabilities).toContain("three:146");
  });

  it("registers R3F rules only for compatible declared library versions", () => {
    const withoutR3f = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
    });
    const withR3fNine = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        hasReactThreeFiber: true,
        reactThreeFiberVersion: "^9.6.1",
        reactThreeFiberMajorVersion: 9,
      }),
    });
    const withR3fTen = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({
        framework: "vite",
        hasReactNativeWorkspace: false,
        hasReactThreeFiber: true,
        reactThreeFiberVersion: "^10.0.0-alpha.2",
        reactThreeFiberMajorVersion: 10,
      }),
    });

    expect(Object.keys(withoutR3f.rules).some((ruleId) => ruleId.includes("/r3f-"))).toBe(false);
    expect(withR3fNine.rules).toHaveProperty("react-doctor/r3f-no-advancing-clock-in-use-frame");
    expect(withR3fNine.rules).not.toHaveProperty(
      "react-doctor/r3f-webgpu-canvas-prop-compatibility",
    );
    expect(withR3fTen.rules).not.toHaveProperty("react-doctor/r3f-no-advancing-clock-in-use-frame");
    expect(withR3fTen.rules).toHaveProperty("react-doctor/r3f-webgpu-canvas-prop-compatibility");
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

  it("forwards the module sources detected before spawning lint workers", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      projectIndexModuleSources: ["next/og", "remotion"],
    });

    expect(config.settings["react-doctor"].projectIndexModuleSources).toEqual([
      "next/og",
      "remotion",
    ]);
  });

  it("forwards configured and generated runtime globals to plugin rules", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      runtimeGlobals: ["DatePicker"],
      unpluginAutoImportGlobalScopes: [
        { directory: "apps/storefront", names: ["Route", "Routes"] },
      ],
    });

    expect(config.settings["react-doctor"]).toMatchObject({
      runtimeGlobals: ["DatePicker"],
      unpluginAutoImportRootDirectories: ["/tmp/project"],
      unpluginAutoImportGlobalScopes: [
        { directory: "apps/storefront", names: ["Route", "Routes"] },
      ],
    });
  });

  it("merges adopted settings without replacing react-doctor settings", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: tailwindViteWebProject,
      runtimeGlobals: ["DatePicker"],
      adoptedSettings: {
        tailwindcss: {
          entryPoint: "src/styles.css",
        },
        "other-plugin": {
          option: "value",
        },
      },
    });

    expect(config.settings.tailwindcss).toEqual({
      entryPoint: "src/styles.css",
    });
    expect(config.settings["other-plugin"]).toEqual({
      option: "value",
    });
    expect(config.settings["react-doctor"].framework).toBe("vite");
    expect(config.settings["react-doctor"].runtimeGlobals).toEqual(["DatePicker"]);
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

  it("keeps opt-in (defaultEnabled: false) rules off by default", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
    });

    expect(config.rules).not.toHaveProperty("react-doctor/forbid-component-props");
    expect(config.rules).not.toHaveProperty("react-doctor/no-all-caps-body-text");
  });

  it("keeps project rules out of the generated oxlint config", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      severityControls: {
        rules: {
          "react-doctor/duplicate-jsx-subtree": "warn",
          "react-doctor/unused-export": "error",
        },
      },
    });

    expect(config.rules).not.toHaveProperty("react-doctor/duplicate-jsx-subtree");
    expect(config.rules).not.toHaveProperty("react-doctor/unused-export");
  });

  it("runs only an explicitly included tag and activates that tag's opt-in rules", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: tailwindViteWebProject,
      includedTags: new Set(["design"]),
      includeTagDefaults: true,
    });

    expect(config.rules).toHaveProperty("react-doctor/no-uppercase-mono-label");
    expect(config.rules).toHaveProperty("react-doctor/no-all-caps-body-text");
    expect(config.rules).not.toHaveProperty("react-doctor/no-multi-comp");
    expect(hasReactHooksJsEntry(config)).toBe(false);
  });

  it("preserves an explicit off override inside an included tag", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: tailwindViteWebProject,
      includedTags: new Set(["design"]),
      includeTagDefaults: true,
      severityControls: {
        rules: { "react-doctor/no-uppercase-mono-label": "off" },
      },
    });

    expect(config.rules).not.toHaveProperty("react-doctor/no-uppercase-mono-label");
  });

  it("does not let a category-level severity flip an opt-in rule on", () => {
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

    expect(config.rules["react-doctor/no-react19-deprecated-apis"]).toBe("error");
    expect(config.rules).not.toHaveProperty("react-doctor/no-multi-component-file");
    expect(config.rules).not.toHaveProperty("react-doctor/no-multi-comp");
  });

  it("accepts the retired no-multi-comp ID through its upstream alias", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      severityControls: { rules: { "react/no-multi-comp": "error" } },
    });

    expect(config.rules["react-doctor/no-multi-comp"]).toBe("error");
    expect(config.rules).not.toHaveProperty("react-doctor/no-multi-component-file");
  });

  it("preserves no-multi-comp off overrides for the curated replacement", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      severityControls: { rules: { "react-doctor/no-multi-comp": "off" } },
    });

    expect(config.rules).not.toHaveProperty("react-doctor/no-multi-comp");
    expect(config.rules).not.toHaveProperty("react-doctor/no-multi-component-file");
  });

  it("allows both component-file policies when both are explicit", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      severityControls: {
        rules: {
          "react/no-multi-comp": "error",
          "react-doctor/no-multi-component-file": "warn",
        },
      },
    });

    expect(config.rules["react-doctor/no-multi-comp"]).toBe("error");
    expect(config.rules["react-doctor/no-multi-component-file"]).toBe("warn");
  });

  it("a per-rule severity opts a default-disabled rule in", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      severityControls: { rules: { "react-doctor/forbid-component-props": "warn" } },
    });

    expect(config.rules["react-doctor/forbid-component-props"]).toBe("warn");
  });

  it("a per-rule severity opts a design rule in", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      severityControls: { rules: { "react-doctor/no-all-caps-body-text": "warn" } },
    });

    expect(config.rules["react-doctor/no-all-caps-body-text"]).toBe("warn");
  });

  it("a legacy alias severity opts a default-disabled rule in", () => {
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
