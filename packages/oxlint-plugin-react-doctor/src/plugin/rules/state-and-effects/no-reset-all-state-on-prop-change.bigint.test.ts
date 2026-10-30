import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

describe("no-reset-all-state-on-prop-change — BigInt values", () => {
  it.each([
    "0n",
    "-17n",
    "0x2an",
    "9007199254740993123456789n",
    "[0n, 42n]",
    "{ nested: { count: 0n } }",
  ])("reports a reset to the matching initial expression %s", (initialExpression) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Counter = ({ revision }) => {
        const [count, setCount] = useState(${initialExpression});
        useEffect(() => setCount(${initialExpression}), [revision]);
        return count;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["0n", "1n"],
    ["-17n", "17n"],
    ["9007199254740993123456789n", "9007199254740993123456790n"],
    ["0n", "0"],
    ["0", "0n"],
    ["0n", '"0"'],
    ['"0"', "0n"],
    ["0n", '"0n"'],
    ["[0n]", "[1n]"],
    ["{ count: 0n }", "{ count: 0 }"],
    ["{ count: 0n }", '{ count: "0" }'],
  ])("stays silent when initial %s changes to %s", (initialExpression, nextExpression) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Counter = ({ revision }) => {
        const [count, setCount] = useState(${initialExpression});
        useEffect(() => setCount(${nextExpression}), [revision]);
        return count;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
