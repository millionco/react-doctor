import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoNewFunctionAsProp } from "./jsx-no-new-function-as-prop.js";

const expectFail = (code: string): void => {
  const result = runRule(jsxNoNewFunctionAsProp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsxNoNewFunctionAsProp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

// Hand-written coverage for the memoised-consumer gate. OXC flags an
// inline handler on ANY consumer; React Doctor only fires when same-file
// analysis proves the consumer is `memo`-wrapped (a fresh function
// reference only breaks a memoized child). The OXC fail fixtures pass
// plain/unknown consumers and are skipped in `oxc-divergences.ts`, so
// these tests are the only fail-coverage for the rule's actual contract.
const memoisedConsumer = `import { memo } from "react";\nconst Item = memo(() => null);\n`;

describe("react-builtins/jsx-no-new-function-as-prop — regressions", () => {
  it("flags an inline function passed to a same-file memo()-wrapped consumer", () => {
    expectFail(`${memoisedConsumer}const Foo = () => <Item prop={() => true} />;`);
  });

  it("does not flag the same inline function on a non-memoised consumer", () => {
    expectPass(`const Item = () => null;\nconst Foo = () => <Item prop={() => true} />;`);
  });
});
