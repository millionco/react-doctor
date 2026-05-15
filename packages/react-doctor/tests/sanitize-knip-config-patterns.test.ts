import { describe, expect, it } from "vite-plus/test";
import { sanitizeKnipConfigPatterns } from "../src/core/sanitize-knip-config-patterns.js";

describe("sanitizeKnipConfigPatterns", () => {
  it("removes empty string values at the top level", () => {
    const parsedConfig: Record<string, unknown> = {
      entry: "",
      project: "src/**/*.ts",
    };
    sanitizeKnipConfigPatterns(parsedConfig);
    expect(parsedConfig).toEqual({ project: "src/**/*.ts" });
  });

  it("removes whitespace-only string values", () => {
    const parsedConfig: Record<string, unknown> = {
      entry: "   ",
      ignore: "\n\t",
      project: "src/**/*.ts",
    };
    sanitizeKnipConfigPatterns(parsedConfig);
    expect(parsedConfig).toEqual({ project: "src/**/*.ts" });
  });

  it("filters empty strings out of arrays", () => {
    const parsedConfig: Record<string, unknown> = {
      entry: ["src/index.ts", "", "src/main.ts"],
    };
    sanitizeKnipConfigPatterns(parsedConfig);
    expect(parsedConfig).toEqual({ entry: ["src/index.ts", "src/main.ts"] });
  });

  it("removes arrays that become empty after filtering", () => {
    const parsedConfig: Record<string, unknown> = {
      entry: ["", "  "],
      project: ["src/**/*.ts"],
    };
    sanitizeKnipConfigPatterns(parsedConfig);
    expect(parsedConfig).toEqual({ project: ["src/**/*.ts"] });
  });

  it("recurses into nested plugin configs and workspaces", () => {
    const parsedConfig: Record<string, unknown> = {
      vite: {
        config: ["", "vite.config.ts"],
        entry: "",
      },
      workspaces: {
        "packages/foo": {
          entry: ["", "src/index.ts"],
          ignore: "",
        },
      },
    };
    sanitizeKnipConfigPatterns(parsedConfig);
    expect(parsedConfig).toEqual({
      vite: { config: ["vite.config.ts"] },
      workspaces: {
        "packages/foo": { entry: ["src/index.ts"] },
      },
    });
  });

  it("preserves non-string entries inside arrays", () => {
    const parsedConfig: Record<string, unknown> = {
      ignoreDependencies: [/regex/, "valid", ""],
    };
    sanitizeKnipConfigPatterns(parsedConfig);
    expect(parsedConfig).toEqual({ ignoreDependencies: [/regex/, "valid"] });
  });

  it("leaves boolean and falsy non-string values untouched", () => {
    const parsedConfig: Record<string, unknown> = {
      vite: false,
      eslint: true,
      tags: [],
      includeEntryExports: false,
    };
    sanitizeKnipConfigPatterns(parsedConfig);
    expect(parsedConfig).toEqual({
      vite: false,
      eslint: true,
      tags: [],
      includeEntryExports: false,
    });
  });
});
