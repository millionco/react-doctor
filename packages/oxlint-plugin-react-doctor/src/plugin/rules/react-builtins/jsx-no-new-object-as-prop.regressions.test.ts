import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoNewObjectAsProp } from "./jsx-no-new-object-as-prop.js";

const expectFail = (code: string): void => {
  const result = runRule(jsxNoNewObjectAsProp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsxNoNewObjectAsProp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

// Hand-written coverage for the memoised-consumer gate (mirrors
// `jsx-no-new-function-as-prop`). OXC's render-local-binding fixtures
// (`const x = {}; <Bar x={x}/>`) use plain consumers and are skipped in
// `oxc-divergences.ts`; these tests cover both the inline-object and the
// render-local-binding paths against a memoised consumer. A plain `foo`
// prop is used (not `config`/`options`/`style`/etc.) so the config-shape
// / always-fresh prop-name skips don't suppress the rule.
const memoisedConsumer = `import { memo } from "react";\nconst Item = memo(() => null);\n`;

describe("react-builtins/jsx-no-new-object-as-prop — regressions", () => {
  it("flags an inline object passed to a same-file memo()-wrapped consumer", () => {
    expectFail(`${memoisedConsumer}const Foo = () => <Item foo={{ a: 1 }} />;`);
  });

  it("flags a render-local object binding passed to a memoised consumer", () => {
    expectFail(
      `${memoisedConsumer}const Foo = () => { const value = {}; return <Item foo={value} />; };`,
    );
  });

  it("does not flag the same object on a non-memoised consumer", () => {
    expectPass(`const Item = () => null;\nconst Foo = () => <Item foo={{ a: 1 }} />;`);
  });
});
