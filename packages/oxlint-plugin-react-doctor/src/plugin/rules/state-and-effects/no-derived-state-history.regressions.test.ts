import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

const peak = `
  import { useEffect, useState } from "react";
  export function Gauge({ reading }) {
    const [peak, setPeak] = useState(0);
    useEffect(() => {
      if (typeof reading === "number" && reading > peak) setPeak(reading);
    }, [reading, peak]);
    return <output>{peak}</output>;
  }
`;

const ranked = `
  import { useEffect, useState } from "react";
  export function Notices({ rank, message }) {
    const [current, setCurrent] = useState(null);
    useEffect(() => {
      if (typeof rank === "number" && typeof message === "string" && (!current || rank > current.rank)) {
        setCurrent({ rank, message });
      }
    }, [rank, message, current]);
    return <output>{current?.message}</output>;
  }
`;

describe.each([noDerivedState, noDerivedStateEffect])("history-dependent output", (rule) => {
  it.each([
    ["keeps a numeric peak", peak, 0],
    ["keeps an owned ranked record", ranked, 0],
    ["reports an equality-guarded mirror", peak.replace("reading > peak", "reading !== peak"), 1],
    [
      "reports a copy after the history guard",
      peak.replace("setPeak(reading);", "setPeak(reading); setPeak(0);"),
      1,
    ],
    ["reports unverified numeric input", peak.replace('typeof reading === "number" && ', ""), 1],
    [
      "reports rendering current input",
      peak.replace("<output>{peak}</output>", "<output>{reading}</output>"),
      1,
    ],
    [
      "reports a different comparison input",
      peak.replace("{ reading }", "{ reading, other }").replace("reading > peak", "other > peak"),
      1,
    ],
    [
      "reports a second effect resetting the same state",
      peak.replace("return <output>", "useEffect(() => setPeak(0), []); return <output>"),
      1,
    ],
    [
      "reports an extra reactive dependency",
      peak.replace("[reading, peak]", "[reading, peak, true]"),
      1,
    ],
    [
      "reports a non-strict ranked update that can make a new record on every effect",
      ranked.replace("rank > current.rank", "rank >= current.rank"),
      1,
    ],
    ["reports a ranked mirror", ranked.replace("rank > current.rank", "rank !== current.rank"), 1],
    [
      "reports the special prototype initializer rather than treating it as an own score",
      ranked
        .replace("rank > current.rank", "rank > current.__proto__")
        .replace("{ rank, message });", "{ __proto__: rank, message });"),
      1,
    ],
    [
      "reports an incomplete record",
      ranked.replace("{ rank, message });", "{ rank, message: String(message) });"),
      1,
    ],
    [
      "reports a getter-like prop reread",
      `
      import { useEffect, useState } from "react";
      export function Notices(props) {
        const [current, setCurrent] = useState(null);
        useEffect(() => {
          if (typeof props.rank === "number" && typeof props.message === "string" &&
            (!current || props.rank > current.rank)) {
            setCurrent({ rank: props.rank, message: props.message });
          }
        }, [props.rank, props.message, current]);
        return <output>{current?.message}</output>;
      }
    `,
      1,
    ],
  ])("%s", (_name, source, count) => {
    const result = runRule(rule, source, { filename: "Example.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });
});
