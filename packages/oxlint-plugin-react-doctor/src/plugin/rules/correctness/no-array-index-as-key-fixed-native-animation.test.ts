import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const meter = `
import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

const BAR_COUNT = 4;
export function Meter({ enabled }: { enabled: boolean }) {
  const bars = useRef(Array(BAR_COUNT).fill(0).map(() => new Animated.Value(0))).current;
  useEffect(() => {
    bars.forEach((bar) => bar.setValue(0));
  }, [enabled]);
  if (!enabled) return null;
  return <View>{bars.map((bar, index) => <Animated.View key={index} style={{ opacity: bar }} />)}</View>;
}
`;

const warnings = (source: string) => {
  const result = runRule(noArrayIndexAsKey, source);
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.length;
};

describe("no-array-index-as-key — private animated values", () => {
  it("accepts the fixed order of privately retained Native Animated values", () => {
    expect(warnings(meter)).toBe(0);
  });

  it("keeps the warning when the array can escape or reorder", () => {
    expect(warnings(meter.replace("  if (!enabled)", "  consume(bars);\n  if (!enabled)"))).toBe(1);
    expect(warnings(meter.replace("  if (!enabled)", "  bars.reverse();\n  if (!enabled)"))).toBe(
      1,
    );
    expect(
      warnings(meter.replace("(bar) => bar.setValue(0)", "(bar, _, whole) => whole.reverse()")),
    ).toBe(1);
    expect(warnings(meter.replace("const BAR_COUNT = 4", "let BAR_COUNT = 4"))).toBe(1);
  });

  it("requires an unmodified array intrinsic and stock animation provider", () => {
    expect(warnings(meter.replace('"react-native"', '"my-animated-library"'))).toBe(1);
    expect(
      warnings(
        meter.replace("  if (!enabled)", "  Array.prototype.map = replaceMap;\n  if (!enabled)"),
      ),
    ).toBe(1);
    expect(
      warnings(
        meter.replace(
          "  if (!enabled)",
          "  Object.getPrototypeOf([]).map = replaceMap;\n  if (!enabled)",
        ),
      ),
    ).toBe(1);
    const replaced = meter.replace(
      'import { Animated, View } from "react-native";',
      'import { Animated, View } from "react-native";\nimport { Animated as Other } from "react-native";\nOther.View = ReplacedView;',
    );
    expect(warnings(replaced)).toBe(1);
    const patchedRef = meter.replace(
      'import { useEffect, useRef } from "react";',
      'import React, { useEffect, useRef } from "react";\nReact.useRef = supplySharedArray;',
    );
    expect(warnings(patchedRef)).toBe(1);
    expect(
      warnings(
        meter.replace(
          "  const bars = useRef",
          "  if (enabled) useRef(shared);\n  const bars = useRef",
        ),
      ),
    ).toBe(1);
  });

  it("keeps the warning for other rendered children or observable instances", () => {
    expect(warnings(meter.replace("<Animated.View", "<StatefulMeter"))).toBe(1);
    expect(warnings(meter.replace("key={index} style=", "key={index} ref={observe} style="))).toBe(
      1,
    );
  });
});
