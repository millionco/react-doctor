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

  const expectPass = (code: string): void => {
    const result = runRule(jsxNoNewArrayAsProp, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  };

  // Verify wave: a destructuring default of an EMPTY array only allocates
  // when the source value is undefined — the same rare-path fallback the
  // rule already exempts as `value ?? []` (data-driven-forms field-array).
  it("does not flag a binding from a destructure default of an empty array", () =>
    expectPass(
      `${memoisedConsumer}const Foo = (props) => { const { fields: formFields = [] } = useFieldApi(props); return <Item payload={formFields} />; }`,
    ));

  it("does not flag a parameter destructure default of an empty array", () =>
    expectPass(`${memoisedConsumer}const Foo = ({ payload = [] }) => <Item payload={payload} />;`));

  it("still flags a destructure default of a NON-empty array literal", () =>
    expectFail(
      `${memoisedConsumer}const Foo = (props) => { const { fields: formFields = [defaultField] } = useFieldApi(props); return <Item payload={formFields} />; }`,
    ));

  it("still flags a render-local binding initialized to a fresh array", () =>
    expectFail(
      `${memoisedConsumer}const Foo = () => { const payload = source.filter(Boolean); return <Item payload={payload} />; }`,
    ));

  // Verify wave: `*Props` pass-through bags (antd MemoInput childProps
  // watch-list) join the skipped data-collection allow-list, mirroring the
  // object rule's CONFIG_OBJECT_PROP_SUFFIXES.
  it("does not flag a *Props-suffixed prop receiving a fresh array", () =>
    expectPass(
      `${memoisedConsumer}const Foo = () => <Item childProps={[a, b, c].concat(extras)} />;`,
    ));

  // Verify wave: `memo(fn, arePropsEqual)` deliberately ignores reference
  // identity (antd MemoInput element-wise compare) — a fresh array cannot
  // break that bailout.
  it("does not flag when the memo consumer has a custom comparator", () =>
    expectPass(
      `import { memo } from "react";
      const Item = memo((props) => props.children, (prev, next) => prev.payload.every((v, i) => v === next.payload[i]));
      const Foo = () => <Item payload={[a, b].concat(c)} />;`,
    ));
});
