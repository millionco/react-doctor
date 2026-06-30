import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoDimensionsGet } from "./rn-no-dimensions-get.js";

describe("react-native/rn-no-dimensions-get — regressions", () => {
  it("stays silent on a local object named Dimensions", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `const Dimensions = new Map([["a", 1]]); export const value = Dimensions.get("a");`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags Dimensions.get imported from react-native", () => {
    const result = runRule(
      rnNoDimensionsGet,
      `import { Dimensions } from "react-native"; export const w = () => Dimensions.get("window");`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
