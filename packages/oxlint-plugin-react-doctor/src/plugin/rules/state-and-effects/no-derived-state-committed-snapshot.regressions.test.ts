import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

const layoutReader = `useLayoutEffect(() => {
  if (previous !== value) onTransition(previous, value);
}, [previous, value, onTransition]);`;

describe.each([noDerivedState, noDerivedStateEffect])("observed committed snapshots", (rule) => {
  it.each([
    ["transition observer", layoutReader, "<span>{value}</span>", 0],
    ["transition observer with no markup", layoutReader, "null", 0],
    ["display only", "", "<span>{previous}</span>", 1],
    [
      "empty comparison",
      "useLayoutEffect(() => { if (previous !== value) {} }, [previous, value]);",
      "<span>{value}</span>",
      1,
    ],
    [
      "missing snapshot dependency",
      layoutReader.replace("[previous, value, onTransition]", "[value, onTransition]"),
      "<span>{value}</span>",
      1,
    ],
    [
      "current-only call",
      layoutReader.replace("onTransition(previous, value)", "onTransition(value, value)"),
      "<span>{value}</span>",
      1,
    ],
    ["render also reads snapshot", layoutReader, "<span>{previous}</span>", 1],
    [
      "non-layout observer",
      layoutReader.replace("useLayoutEffect", "useEffect"),
      "<span>{value}</span>",
      1,
    ],
  ])("handles %s", (_name, layout, output, count) => {
    const result = runRule(
      rule,
      `
      import { useState, useLayoutEffect, useEffect } from "react";
      export function Example({ value, onTransition }) {
        const [previous, setPrevious] = useState(() => value);
        ${layout}
        useEffect(() => { setPrevious(() => value); }, [value]);
        return ${output};
      }
    `,
      { filename: "Example.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });
});
