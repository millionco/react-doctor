import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnReanimated4NoRemovedApi } from "./rn-reanimated-4-no-removed-api.js";

const REMOVED_API_NAMES = [
  "useAnimatedGestureHandler",
  "useWorkletCallback",
  "combineTransition",
  "addWhitelistedNativeProps",
  "addWhitelistedUIProps",
];

describe("react-native/rn-reanimated-4-no-removed-api", () => {
  it.each(REMOVED_API_NAMES)("flags the removed %s API", (apiName) => {
    const result = runRule(
      rnReanimated4NoRemovedApi,
      `import { ${apiName} } from "react-native-reanimated"; ${apiName}({});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(apiName);
    expect(result.diagnostics[0].message).toContain("Reanimated 4");
  });

  it("resolves renamed imports", () => {
    const result = runRule(
      rnReanimated4NoRemovedApi,
      `import { useWorkletCallback as makeWorklet } from "react-native-reanimated";
      makeWorklet(() => {});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("useWorkletCallback");
  });

  it("resolves namespace imports and const aliases", () => {
    const result = runRule(
      rnReanimated4NoRemovedApi,
      `import * as Reanimated from "react-native-reanimated";
      const Animation = Reanimated;
      const legacyHandler = Animation["useAnimatedGestureHandler"];
      legacyHandler({});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves an API destructured from a namespace alias", () => {
    const result = runRule(
      rnReanimated4NoRemovedApi,
      `import * as Reanimated from "react-native-reanimated";
      const Animation = Reanimated;
      const { useWorkletCallback: makeWorklet } = Animation;
      makeWorklet(() => {});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a same-named local function", () => {
    const result = runRule(
      rnReanimated4NoRemovedApi,
      `const useAnimatedGestureHandler = (handlers) => handlers;
      useAnimatedGestureHandler({});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an import from another package", () => {
    const result = runRule(
      rnReanimated4NoRemovedApi,
      `import { combineTransition } from "./transitions"; combineTransition({});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the Reanimated import is shadowed", () => {
    const result = runRule(
      rnReanimated4NoRemovedApi,
      `import { useWorkletCallback } from "react-native-reanimated";
      const Component = () => {
        const useWorkletCallback = (callback) => callback;
        return useWorkletCallback(() => {});
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a dynamic namespace property", () => {
    const result = runRule(
      rnReanimated4NoRemovedApi,
      `import * as Reanimated from "react-native-reanimated";
      const apiName = "useAnimatedGestureHandler";
      Reanimated[apiName]({});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a type-only import", () => {
    const result = runRule(
      rnReanimated4NoRemovedApi,
      `import type { useAnimatedGestureHandler } from "react-native-reanimated";
      useAnimatedGestureHandler({});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a type-only namespace import", () => {
    const result = runRule(
      rnReanimated4NoRemovedApi,
      `import type * as Reanimated from "react-native-reanimated";
      Reanimated.useAnimatedGestureHandler({});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
