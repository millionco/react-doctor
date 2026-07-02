import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoNonNativeNavigator } from "./rn-no-non-native-navigator.js";

describe("react-native/rn-no-non-native-navigator — regressions", () => {
  it("stays silent on a type-only import from a JS navigator package", () => {
    const result = runRule(
      rnNoNonNativeNavigator,
      `import type { StackNavigationProp } from "@react-navigation/stack";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a value import from a JS navigator package", () => {
    const result = runRule(
      rnNoNonNativeNavigator,
      `import { createStackNavigator } from "@react-navigation/stack";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot: a fully inline-type import is erased, so it instantiates no navigator at runtime.
  it("stays silent on a fully inline-type navigator import", () => {
    const result = runRule(
      rnNoNonNativeNavigator,
      `import { type StackNavigationProp } from "@react-navigation/stack";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
