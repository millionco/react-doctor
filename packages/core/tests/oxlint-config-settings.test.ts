import * as fs from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "../src/index.js";
import { NATIVE_REACT_DOCTOR_RULE_IDS } from "../src/constants.js";
import { createOxlintConfig, type OxlintConfigOptions } from "../src/runners/oxlint/config.js";
import type { WorkerSlots } from "../src/utils/create-worker-slots.js";
import {
  resolveNativeOxlintBatchOptions,
  type ResolveNativeOxlintBatchOptionsInput,
} from "../src/utils/resolve-native-oxlint-batch-options.js";

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

const resolveConfiguredNativeBatchOptions = (
  overrides: Partial<ResolveNativeOxlintBatchOptionsInput> = {},
): ReturnType<typeof resolveNativeOxlintBatchOptions> =>
  resolveNativeOxlintBatchOptions({
    config: createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      nativeRuleIds: NATIVE_REACT_DOCTOR_RULE_IDS,
    }),
    nativeBindingPath: "/tmp/native.node",
    concurrency: 10,
    spawnSlots: undefined,
    fileCount: 2000,
    availableThreads: 12,
    ...overrides,
  });

const opaqueWorkerSlots: WorkerSlots = { run: (task) => task() };

describe("native lint batch and thread budgets", () => {
  it("uses one native thread when outer workers already cover the CPU budget", () => {
    expect(resolveConfiguredNativeBatchOptions()?.threadCount).toBe(1);
    expect(resolveConfiguredNativeBatchOptions({ fileCount: 1999 })).toBeUndefined();
    expect(resolveConfiguredNativeBatchOptions({ concurrency: 2 })).toBeUndefined();
    expect(resolveConfiguredNativeBatchOptions({ availableThreads: 20 })).toBeUndefined();
  });

  it.each([undefined, 0, 1, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "preserves native parallelism for serial or invalid outer concurrency %s",
    (concurrency) => {
      expect(resolveConfiguredNativeBatchOptions({ concurrency })).toBeUndefined();
    },
  );

  it("uses the same fractional and upper-bound concurrency clamp as the spawn scheduler", () => {
    expect(resolveConfiguredNativeBatchOptions({ concurrency: 10.9 })?.threadCount).toBe(1);
    expect(
      resolveConfiguredNativeBatchOptions({ concurrency: 100, fileCount: 6400 })?.threadCount,
    ).toBe(1);
    expect(
      resolveConfiguredNativeBatchOptions({ concurrency: 100, fileCount: 6399 }),
    ).toBeUndefined();
  });

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "keeps the default for an unknown or invalid shared pool capacity %s",
    (slotCount) => {
      expect(
        resolveConfiguredNativeBatchOptions({ spawnSlots: { ...opaqueWorkerSlots, slotCount } }),
      ).toBeUndefined();
    },
  );

  it("respects a shared pool smaller than the requested process count", () => {
    for (const slotCount of [1, 2, 6]) {
      expect(
        resolveConfiguredNativeBatchOptions({ spawnSlots: { ...opaqueWorkerSlots, slotCount } }),
      ).toBeUndefined();
    }
    const spawnSlots = { ...opaqueWorkerSlots, slotCount: 7 };
    expect(resolveConfiguredNativeBatchOptions({ spawnSlots, fileCount: 1400 })?.threadCount).toBe(
      1,
    );
    expect(resolveConfiguredNativeBatchOptions({ spawnSlots, fileCount: 1399 })).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not infer a budget from an invalid CPU count %s",
    (availableThreads) => {
      expect(resolveConfiguredNativeBatchOptions({ availableThreads })).toBeUndefined();
    },
  );

  it.each<Partial<ReturnType<typeof createOxlintConfig>>>([
    { plugins: [] },
    { plugins: ["react-doctor-native", "react"] },
    { jsPlugins: ["/tmp/custom-plugin.js"] },
    { jsPlugins: [{ name: "react-hooks-js", specifier: "/tmp/compiler-plugin.js" }] },
    { extends: ["/tmp/inherited.json"] },
    { extends: [] },
    { rules: {} },
    { rules: { "react-doctor/no-document-write": "warn" } },
  ])("retains default threading for non-native or inherited configuration %j", (overrides) => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      nativeRuleIds: NATIVE_REACT_DOCTOR_RULE_IDS,
    });
    expect(
      resolveConfiguredNativeBatchOptions({ config: { ...config, ...overrides } }),
    ).toBeUndefined();
  });

  it("requires a native binding even when every configured rule has the native namespace", () => {
    expect(resolveConfiguredNativeBatchOptions({ nativeBindingPath: "" })).toBeUndefined();
  });

  it.each([
    [2000, 200],
    [3000, 200],
    [3001, 500],
    [3565, 500],
  ])("keeps enough outer batches for %i files on twelve CPUs", (fileCount, maxFilesPerBatch) => {
    expect(resolveConfiguredNativeBatchOptions({ fileCount })).toEqual({
      threadCount: 1,
      maxFilesPerBatch,
    });
  });

  it.each([
    [11, 2500, 200],
    [11, 2501, 500],
    [13, 3000, 200],
    [13, 3001, 500],
  ])(
    "uses the same strict-majority batch guard on %i CPUs with %i files",
    (availableThreads, fileCount, maxFilesPerBatch) => {
      expect(resolveConfiguredNativeBatchOptions({ availableThreads, fileCount })).toEqual({
        threadCount: 1,
        maxFilesPerBatch,
      });
    },
  );

  it("requires both shared capacity and enough larger batches before increasing the cap", () => {
    expect(
      resolveConfiguredNativeBatchOptions({
        fileCount: 3565,
        spawnSlots: { ...opaqueWorkerSlots, slotCount: 6 },
      }),
    ).toBeUndefined();
    const spawnSlots = { ...opaqueWorkerSlots, slotCount: 7 };
    expect(resolveConfiguredNativeBatchOptions({ spawnSlots, fileCount: 3000 })).toEqual({
      threadCount: 1,
      maxFilesPerBatch: 200,
    });
    expect(resolveConfiguredNativeBatchOptions({ spawnSlots, fileCount: 3001 })).toEqual({
      threadCount: 1,
      maxFilesPerBatch: 500,
    });
    expect(
      resolveConfiguredNativeBatchOptions({
        concurrency: 6,
        fileCount: 3565,
        spawnSlots: { ...opaqueWorkerSlots, slotCount: 10 },
      }),
    ).toBeUndefined();
  });

  it("does not admit inherited configurations even when a larger batch fills the CPU budget", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      nativeRuleIds: NATIVE_REACT_DOCTOR_RULE_IDS,
      extendsPaths: ["/tmp/inherited.json"],
    });
    expect(resolveConfiguredNativeBatchOptions({ config, fileCount: 3565 })).toBeUndefined();
  });
});

describe("createOxlintConfig settings", () => {
  it("keeps the application allowlist synchronized with the native build manifest", () => {
    const upstreamManifest = JSON.parse(
      fs.readFileSync(new URL("../../../native/oxlint/upstream.json", import.meta.url), "utf8"),
    );

    expect([...NATIVE_REACT_DOCTOR_RULE_IDS]).toEqual(upstreamManifest.nativeRules);
  });

  it("moves selected React Doctor rules into the native plugin", () => {
    const stockConfig = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
    });
    const nativeConfig = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      nativeRuleIds: new Set(["no-document-write"]),
    });

    expect(stockConfig.rules["react-doctor/no-document-write"]).toBe("warn");
    expect(stockConfig.plugins).toEqual([]);
    expect(nativeConfig.rules).not.toHaveProperty("react-doctor/no-document-write");
    expect(nativeConfig.rules["react-doctor-native/no-document-write"]).toBe("warn");
    expect(nativeConfig.plugins).toEqual(["react-doctor-native"]);
    expect(nativeConfig.jsPlugins).toContain("/tmp/plugin.js");
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

  it.each<OxlintConfigOptions["ruleSelection"]>([undefined, "cacheable", "sidecar"])(
    "omits the unused JavaScript plugin for native %s rules",
    (ruleSelection) => {
      const config = createOxlintConfig({
        pluginPath: "/tmp/plugin.js",
        project: viteWebProject,
        nativeRuleIds: NATIVE_REACT_DOCTOR_RULE_IDS,
        ruleSelection,
      });

      expect(Object.keys(config.rules).length).toBeGreaterThan(0);
      expect(config.plugins).toEqual(["react-doctor-native"]);
      expect(config.jsPlugins).toEqual([]);
      expect(config.settings["react-doctor"].portedRuleMode).toBe("curated");
    },
  );

  it("retains the JavaScript plugin for inherited native configurations", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      nativeRuleIds: NATIVE_REACT_DOCTOR_RULE_IDS,
      extendsPaths: ["/tmp/inherited.json"],
    });

    expect(config.extends).toEqual(["/tmp/inherited.json"]);
    expect(config.jsPlugins).toEqual(["/tmp/plugin.js"]);
  });

  it("retains the JavaScript plugin when the native sidecar has no selected rules", () => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      nativeRuleIds: NATIVE_REACT_DOCTOR_RULE_IDS,
      ruleSelection: "sidecar",
      sidecarRuleIdFilter: new Set(),
    });

    expect(config.rules).toEqual({});
    expect(config.jsPlugins).toEqual(["/tmp/plugin.js"]);
  });

  it("retains plugin ordering for native rules with user plugins", () => {
    const userPlugin = { name: "custom", specifier: "/tmp/custom-plugin.js" };
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: viteWebProject,
      nativeRuleIds: NATIVE_REACT_DOCTOR_RULE_IDS,
      userPlugins: [
        {
          entry: userPlugin,
          availableRuleNames: new Set(["example"]),
          originalSpec: "/tmp/custom-plugin.js",
        },
      ],
      severityControls: { rules: { "custom/example": "warn" } },
    });

    expect(config.rules["custom/example"]).toBe("warn");
    expect(config.jsPlugins).toEqual([userPlugin, "/tmp/plugin.js"]);
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

  it.each([{ hasReactCompiler: true }, { hasReactCompilerLintPlugin: true }])(
    "omits the unused canonical plugin with native rules and compiler settings %j",
    (compilerSettings) => {
      const config = createOxlintConfig({
        pluginPath: "/tmp/plugin.js",
        project: buildProject(compilerSettings),
        nativeRuleIds: NATIVE_REACT_DOCTOR_RULE_IDS,
      });

      expect(hasReactHooksJsEntry(config)).toBe(true);
      expect(config.jsPlugins).toHaveLength(1);
      expect(config.jsPlugins).not.toContain("/tmp/plugin.js");
      expect(config.rules["react-doctor-native/no-document-write"]).toBe("warn");
      expect(
        Object.keys(config.rules).some((ruleKey) => ruleKey.startsWith("react-hooks-js/")),
      ).toBe(true);
    },
  );

  it.each<Partial<OxlintConfigOptions>>([
    { extendsPaths: ["/tmp/inherited.json"] },
    { nativeRuleIds: new Set(["no-document-write"]) },
    { nativeRuleIds: new Set() },
  ])("retains the canonical plugin with compiler settings and overrides %j", (overrides) => {
    const config = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({ hasReactCompiler: true }),
      nativeRuleIds: NATIVE_REACT_DOCTOR_RULE_IDS,
      ...overrides,
    });

    expect(hasReactHooksJsEntry(config)).toBe(true);
    expect(config.jsPlugins.at(-1)).toBe("/tmp/plugin.js");
  });

  it.each(["custom", "react-hooks-js"])(
    "retains user plugin %s alongside the compiler and canonical plugins",
    (name) => {
      const userPlugin = { name, specifier: "/tmp/user-plugin.js" };
      const config = createOxlintConfig({
        pluginPath: "/tmp/plugin.js",
        project: buildProject({ hasReactCompiler: true }),
        nativeRuleIds: NATIVE_REACT_DOCTOR_RULE_IDS,
        userPlugins: [
          {
            entry: userPlugin,
            availableRuleNames: new Set(["example"]),
            originalSpec: userPlugin.specifier,
          },
        ],
        severityControls: { rules: { [`${name}/example`]: "warn" } },
      });

      expect(hasReactHooksJsEntry(config)).toBe(true);
      expect(config.jsPlugins).toHaveLength(3);
      expect(config.jsPlugins.slice(1)).toEqual([userPlugin, "/tmp/plugin.js"]);
      expect(config.rules[`${name}/example`]).toBe("warn");
    },
  );

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

    expect(config.rules["react-doctor/no-multi-component-file"]).toBe("error");
    expect(config.rules).not.toHaveProperty("react-doctor/no-multi-comp");
  });

  it("opts the faithful no-multi-comp port in through its upstream alias", () => {
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
