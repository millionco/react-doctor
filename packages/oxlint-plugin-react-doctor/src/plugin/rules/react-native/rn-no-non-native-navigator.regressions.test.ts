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

  // The doc scopes the rule to @react-navigation/stack and /drawer;
  // bottom-tabs has no native drop-in before v7, so the fix is unactionable.
  it("stays silent on @react-navigation/bottom-tabs (out of documented scope)", () => {
    const result = runRule(
      rnNoNonNativeNavigator,
      `import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a state-reading hook import (useDrawerStatus creates no navigator)", () => {
    const result = runRule(
      rnNoNonNativeNavigator,
      `import { useDrawerStatus } from "@react-navigation/drawer";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an options-helper import (CardStyleInterpolators creates no navigator)", () => {
    const result = runRule(
      rnNoNonNativeNavigator,
      `import { CardStyleInterpolators } from "@react-navigation/stack";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags createDrawerNavigator", () => {
    const result = runRule(
      rnNoNonNativeNavigator,
      `import { createDrawerNavigator } from "@react-navigation/drawer";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a namespace import that can reach the factory", () => {
    const result = runRule(
      rnNoNonNativeNavigator,
      `import * as Stack from "@react-navigation/stack";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
