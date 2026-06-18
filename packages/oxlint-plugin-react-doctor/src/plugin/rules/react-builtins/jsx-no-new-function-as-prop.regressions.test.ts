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
// reference only breaks a memoized child). Every OXC fail fixture passes
// a plain/unknown consumer and is therefore skipped in
// `oxc-divergences.ts`, so these tests are the only fail-coverage for the
// rule. They mirror the detection SHAPES the OXC fixtures exercised
// (inline fn, `.bind`, `new Function`, logical / conditional fallbacks,
// render-local bindings), but against a same-file `memo()` consumer so
// the gate doesn't suppress them.
const memoised = (jsx: string): string =>
  `import { memo } from "react";\nconst Item = memo(() => null);\n${jsx}`;

describe("react-builtins/jsx-no-new-function-as-prop — regressions", () => {
  it("flags an inline arrow function", () => {
    expectFail(memoised(`const Foo = () => <Item prop={() => true} />;`));
  });

  it("flags an inline function expression", () => {
    expectFail(memoised(`const Foo = () => <Item prop={function () { return true; }} />;`));
  });

  it("flags a `.bind()` call", () => {
    expectFail(memoised(`const Foo = ({ handler }) => <Item prop={handler.bind(null)} />;`));
  });

  it("flags a `new Function(...)` expression", () => {
    expectFail(memoised(`const Foo = () => <Item prop={new Function("a", "return a")} />;`));
  });

  it("flags a logical-fallback handler (`cb || (() => {})`)", () => {
    expectFail(memoised(`const Foo = ({ cb }) => <Item prop={cb || (() => {})} />;`));
  });

  it("flags a conditional handler (`cond ? cb : () => {}`)", () => {
    expectFail(memoised(`const Foo = ({ cond, cb }) => <Item prop={cond ? cb : () => {}} />;`));
  });

  it("flags a render-local function declaration binding", () => {
    expectFail(
      memoised(
        `const Foo = () => { function handler(e) { doThing(e); } return <Item prop={handler} />; };`,
      ),
    );
  });

  it("does not flag the same inline function on a non-memoised consumer", () => {
    expectPass(`const Item = () => null;\nconst Foo = () => <Item prop={() => true} />;`);
  });
});
