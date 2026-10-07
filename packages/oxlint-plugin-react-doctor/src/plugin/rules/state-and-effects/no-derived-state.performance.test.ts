import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

const SMALL_LOCAL_COUNT = 50;
const LARGE_LOCAL_COUNT = 200;
const MEASUREMENT_SAMPLE_COUNT = 5;
const MAXIMUM_SCALING_MULTIPLIER = 10;

const buildEffectWithLocalDerivations = (localCount: number): string => {
  const declarations = Array.from(
    { length: localCount },
    (_, localIndex) => `const value${localIndex} = source + ${localIndex};`,
  ).join("\n");
  const localNames = Array.from(
    { length: localCount },
    (_, localIndex) => `value${localIndex}`,
  ).join(",");
  return `
    import { useEffect, useState } from "react";
    export const Component = ({ source }) => {
      const [derived, setDerived] = useState("");
      useEffect(() => {
        ${declarations}
        setDerived([${localNames}].join(","));
      }, [source]);
      return <div>{derived}</div>;
    };
  `;
};

const measureFastestDuration = (localCount: number): number => {
  const source = buildEffectWithLocalDerivations(localCount);
  const sampleDurations = Array.from({ length: MEASUREMENT_SAMPLE_COUNT }, () => {
    const startedAt = process.hrtime.bigint();
    const result = runRule(noDerivedState, source, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    return Number(process.hrtime.bigint() - startedAt);
  });
  return Math.min(...sampleDurations);
};

describe("no-derived-state performance", () => {
  it("scales near-linearly with effect-local derivations", () => {
    measureFastestDuration(SMALL_LOCAL_COUNT);
    measureFastestDuration(LARGE_LOCAL_COUNT);
    const smallDuration = measureFastestDuration(SMALL_LOCAL_COUNT);
    const largeDuration = measureFastestDuration(LARGE_LOCAL_COUNT);
    expect(largeDuration).toBeLessThan(smallDuration * MAXIMUM_SCALING_MULTIPLIER);
  });
});
