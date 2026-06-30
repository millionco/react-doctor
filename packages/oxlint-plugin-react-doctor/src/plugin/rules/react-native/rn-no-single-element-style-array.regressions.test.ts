import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoSingleElementStyleArray } from "./rn-no-single-element-style-array.js";

describe("react-native/rn-no-single-element-style-array — regressions", () => {
  it("stays silent on a single spread element (clones an array of styles)", () => {
    const result = runRule(
      rnNoSingleElementStyleArray,
      `const C = () => <View style={[...baseStyles]} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a real single-value wrapper", () => {
    const result = runRule(
      rnNoSingleElementStyleArray,
      `const C = () => <View style={[styles.box]} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
