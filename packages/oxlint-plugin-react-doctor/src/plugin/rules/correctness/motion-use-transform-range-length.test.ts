import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionUseTransformRangeLength } from "./motion-use-transform-range-length.js";

describe("motion-use-transform-range-length", () => {
  it("reports unequal static ranges through named and namespace imports", () => {
    const result = runRule(
      motionUseTransformRangeLength,
      `import { useTransform as mapValue } from "motion/react";
       import * as Motion from "framer-motion";
       const a = mapValue(value, [0, 1], [0]);
       const b = Motion.useTransform(value, [0, 1, 2], ["0%", "100%"]);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows equal ranges and skips functional or dynamic mappings", () => {
    const result = runRule(
      motionUseTransformRangeLength,
      `import { useTransform } from "motion/react";
       const a = useTransform(value, [0, 1], [0, 100]);
       const b = useTransform(value, (latest) => latest * 2);
       const c = useTransform(value, inputRange, outputRange);
       const d = useTransform(value, [0, ...rest], [0]);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores unrelated useTransform helpers", () => {
    const result = runRule(
      motionUseTransformRangeLength,
      `const useTransform = (...values) => values; useTransform(value, [0, 1], [0]);`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
