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

  it("stays silent on a static string literal like '10%'", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      `const C = () => <ScrollView contentContainerStyle={{ paddingBottom: "10%" }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an expression-free template literal", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      "const C = () => <ScrollView contentContainerStyle={{ paddingBottom: `10%` }} />;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an interpolated template literal", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      "const C = ({ pct }) => <ScrollView contentContainerStyle={{ paddingBottom: `${pct}%` }} />;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a let binding reassigned to a dynamic value", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      `const C = ({ keyboardHeight }) => {
  let bottomPad = 16;
  if (keyboardHeight > 0) bottomPad = keyboardHeight;
  return <ScrollView contentContainerStyle={{ paddingBottom: bottomPad }} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a const initialized from a hook member expression", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      `const C = () => {
  const insets = useSafeAreaInsets();
  const bottomPad = insets.bottom;
  return <ScrollView contentContainerStyle={{ paddingBottom: bottomPad }} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an inline dynamic member expression", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      `const C = () => {
  const insets = useSafeAreaInsets();
  return <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom }} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a const derived from static const arithmetic", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      `const TAB_BAR_HEIGHT = 56;
const EXTRA = TAB_BAR_HEIGHT + 8;
const C = () => <ScrollView contentContainerStyle={{ paddingBottom: EXTRA }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a negated static const", () => {
    const result = runRule(
      rnScrollviewDynamicPadding,
      `const OVERLAP = 12;
const C = () => <ScrollView contentContainerStyle={{ paddingTop: -OVERLAP }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
