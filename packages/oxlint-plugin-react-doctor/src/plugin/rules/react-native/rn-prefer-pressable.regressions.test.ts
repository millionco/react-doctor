import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnPreferPressable } from "./rn-prefer-pressable.js";

describe("react-native/rn-prefer-pressable — regressions", () => {
  it("stays silent on a type-only declaration import", () => {
    const result = runRule(
      rnPreferPressable,
      `import type { TouchableHighlight } from "react-native";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an inline type-only specifier", () => {
    const result = runRule(
      rnPreferPressable,
      `import { type TouchableOpacity } from "react-native";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a value import of a Touchable component", () => {
    const result = runRule(rnPreferPressable, `import { TouchableOpacity } from "react-native";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
