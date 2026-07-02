import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnBottomSheetPreferNative } from "./rn-bottom-sheet-prefer-native.js";

describe("react-native/rn-bottom-sheet-prefer-native — regressions", () => {
  it("stays silent on a type-only import from a JS bottom-sheet package", () => {
    const result = runRule(
      rnBottomSheetPreferNative,
      `import type { ActionSheetRef } from "react-native-actions-sheet";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an inline type-only specifier", () => {
    const result = runRule(
      rnBottomSheetPreferNative,
      `import { type ActionSheetRef } from "react-native-actions-sheet";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a value import from a JS bottom-sheet package", () => {
    const result = runRule(
      rnBottomSheetPreferNative,
      `import ActionSheet from "react-native-actions-sheet";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a mixed default + inline type import", () => {
    const result = runRule(
      rnBottomSheetPreferNative,
      `import ActionSheet, { type Ref } from "react-native-actions-sheet";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
