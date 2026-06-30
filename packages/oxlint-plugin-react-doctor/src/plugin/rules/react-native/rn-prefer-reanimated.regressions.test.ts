import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnPreferReanimated } from "./rn-prefer-reanimated.js";

describe("react-native/rn-prefer-reanimated — regressions", () => {
  it("stays silent on a type-only declaration import", () => {
    const result = runRule(rnPreferReanimated, `import type { Animated } from "react-native";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an inline type-only specifier", () => {
    const result = runRule(rnPreferReanimated, `import { type Animated } from "react-native";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a value import of Animated", () => {
    const result = runRule(rnPreferReanimated, `import { Animated } from "react-native";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
