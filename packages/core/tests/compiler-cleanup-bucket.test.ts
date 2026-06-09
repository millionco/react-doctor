import { describe, expect, it } from "vite-plus/test";

import type { ProjectInfo } from "../src/index.js";
import { createOxlintConfig } from "../src/runners/oxlint/config.js";

const MANUAL_MEMO_KEY = "react-doctor/react-compiler-no-manual-memoization";

const buildProject = (overrides: Partial<ProjectInfo> = {}): ProjectInfo => ({
  rootDirectory: "/tmp/project",
  projectName: "project",
  reactVersion: "^19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "unknown",
  hasTypeScript: true,
  hasReactCompiler: true,
  hasTanStackQuery: false,
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
  ...overrides,
});

const buildRules = (
  buckets?: Record<string, "error" | "warn" | "off">,
  rules?: Record<string, "error" | "warn" | "off">,
): Record<string, unknown> =>
  createOxlintConfig({
    pluginPath: "/tmp/plugin.js",
    project: buildProject(),
    severityControls:
      buckets || rules
        ? { ...(buckets ? { buckets } : {}), ...(rules ? { rules } : {}) }
        : undefined,
  }).rules;

describe("compiler-cleanup severity bucket", () => {
  it("ships react-compiler-no-manual-memoization as a warning by default", () => {
    expect(buildRules()[MANUAL_MEMO_KEY]).toBe("warn");
  });

  it("re-enables errors when the compiler-cleanup bucket is set to error", () => {
    expect(buildRules({ "compiler-cleanup": "error" })[MANUAL_MEMO_KEY]).toBe("error");
  });

  it("lets a per-rule override win over the bucket", () => {
    const rules = buildRules({ "compiler-cleanup": "error" }, { [MANUAL_MEMO_KEY]: "warn" });
    expect(rules[MANUAL_MEMO_KEY]).toBe("warn");
  });

  it("drops the rule when the bucket is set to off", () => {
    expect(buildRules({ "compiler-cleanup": "off" })[MANUAL_MEMO_KEY]).toBeUndefined();
  });

  it("does not register the rule at all without React Compiler", () => {
    const rules = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project: buildProject({ hasReactCompiler: false }),
    }).rules;
    expect(rules[MANUAL_MEMO_KEY]).toBeUndefined();
  });
});
