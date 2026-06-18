import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoNewArrayAsProp } from "./jsx-no-new-array-as-prop.js";

const expectFail = (code: string): void => {
  const result = runRule(jsxNoNewArrayAsProp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

describe("react-builtins/jsx-no-new-array-as-prop — regressions", () => {
  // Bugbot review: OXC's port required `.concat()` to take exactly one
  // arg; we broaden to any-arg since `arr.concat()` (shallow copy) and
  // `arr.concat(a, b)` (multi-element) also allocate a new array.
  // NOTE: use a non-skipped prop name (`payload` rather than `list` /
  // `items` / `data`) so the data-array-prop-name skip doesn't
  // suppress the rule, and declare `Item` as a same-file `memo(...)`
  // consumer so the memoised-consumer gate doesn't suppress it either.
  const memoisedConsumer = `import { memo } from "react";\nconst Item = memo(() => null);\n`;
  it("flags arrow with zero-arg .concat() (shallow copy)", () =>
    expectFail(`${memoisedConsumer}const Foo = () => (<Item payload={arr1.concat()} />)`));
  it("flags arrow with multi-arg .concat(a, b)", () =>
    expectFail(`${memoisedConsumer}const Foo = () => (<Item payload={arr1.concat(a, b)} />)`));
});
