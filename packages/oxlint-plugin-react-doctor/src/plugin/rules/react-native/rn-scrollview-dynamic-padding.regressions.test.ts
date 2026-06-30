import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnScrollviewDynamicPadding } from "./rn-scrollview-dynamic-padding.js";

describe("react-native/rn-scrollview-dynamic-padding — regressions", () => {
  it("stays silent on a static numeric module constant", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      `const TAB_BAR_HEIGHT = 56;
const C = () => <ScrollView contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a dynamic state/hook value", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      `const C = ({ keyboardHeight }) => <ScrollView contentContainerStyle={{ paddingBottom: keyboardHeight }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on arithmetic over static numeric values", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      `const BASE = 16;
const C = () => <ScrollView contentContainerStyle={{ paddingBottom: BASE + 8 }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags arithmetic that includes a dynamic value", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      `const C = ({ keyboardHeight }) => <ScrollView contentContainerStyle={{ paddingBottom: keyboardHeight + 8 }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
