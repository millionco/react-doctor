import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hookUseState } from "./hook-use-state.js";

const readOnlyState = `
  import { useState } from "react";
  const Widget = ({ labels, index }: { labels: readonly string[]; index: number }) => {
    const [initial] = useState(labels[index] ?? "Start");
    return <span>{initial}</span>;
  };
`;

const check = (source: string, portedRuleMode: "curated" | "upstream" = "curated") => {
  const result = runRule(hookUseState, source, {
    settings: { "react-doctor": { portedRuleMode } },
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

describe("hook-use-state value-only bindings", () => {
  it.each([
    readOnlyState,
    readOnlyState.replace('labels[index] ?? "Start"', '() => labels[index] ?? "Start"'),
    readOnlyState.replace(
      'useState(labels[index] ?? "Start")',
      '(useState(labels[index] ?? "Start") as [string, (value: string) => void])',
    ),
  ])("accepts a const value-only binding in curated mode", (source) => {
    expect(check(source)).toEqual([]);
    expect(check(source, "upstream")).toHaveLength(1);
  });

  it.each([
    readOnlyState.replace("const [initial]", "let [initial]"),
    readOnlyState.replaceAll("initial", "INITIAL"),
    readOnlyState.replace("[initial]", "[,]"),
    readOnlyState.replace("[initial]", "[...initial]"),
    readOnlyState.replace("[initial]", "[initial, updateCurrent]"),
    readOnlyState.replace("[initial]", "[initial, setInitial, extra]"),
  ])("reports invalid or non-const state bindings", (source) => {
    expect(check(source)).toHaveLength(1);
  });

  it("accepts a standard value and setter", () => {
    expect(check(readOnlyState.replace("[initial]", "[initial, setInitial]"))).toEqual([]);
  });
});
