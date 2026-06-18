import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxKey } from "./jsx-key.js";

const expectFail = (code: string): void => {
  const result = runRule(jsxKey, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsxKey, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("react-builtins/jsx-key — regressions", () => {
  // Bugbot review: key sandwiched between two spreads should still flag
  // (key appears after the FIRST spread, even if before LATER spreads).
  it("flags key between two spreads", () => expectFail(`[<App {...a} key="x" {...b} />];`));

  it("does not flag shorthand fragments returned from iterators", () => {
    expectPass(`items.map((item) => <>{item.name}</>);`);
  });

  it("does not flag shorthand fragments in array literals", () => {
    expectPass(`[<>one</>, <>two</>];`);
  });

  it("does not flag shorthand fragments even when the old explicit setting is present", () => {
    const result = runRule(jsxKey, `items.map((item) => <>{item.name}</>);`, {
      settings: { "react-doctor": { jsxKey: { checkFragmentShorthand: true } } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Stable id-spread: spreading the whole iteration item is the "row carries
  // its own identity" shape. We stay silent there but keep firing on genuine
  // keyless lists.
  it("does not flag a list element that spreads the iteration item", () => {
    expectPass(`items.map(item => <Item {...item} />);`);
  });

  it("does not flag a function-expression iterator spreading the item", () => {
    expectPass(`items.map(function (item) { return <Item {...item} />; });`);
  });

  it("does not flag Array.from spreading the item", () => {
    expectPass(`Array.from(items, (item) => <Item {...item} />);`);
  });

  it("still flags a keyless list element that does not spread the item", () => {
    expectFail(`items.map(item => <Item name={item.name} />);`);
  });

  it("still flags when spreading something other than the iteration item", () => {
    expectFail(`items.map(item => <Item {...other} />);`);
  });

  it("still flags an array-literal element that spreads an identifier", () => {
    expectFail(`[<Item {...item} />];`);
  });

  // Consumer-keys-internally: an element collection handed to a non-`children`
  // prop is the receiving component's responsibility to key. React only
  // key-validates `props.children`, so flagging the producer site is noise.
  it("does not flag an array literal passed to a non-children prop", () => {
    expectPass(`<Tabs items={[<Tab />, <Tab />]} />;`);
  });

  it("does not flag a mapped collection passed to a non-children prop", () => {
    expectPass(`<Menu items={data.map((d) => <MenuItem label={d.label} />)} />;`);
  });

  it("does not flag an optional-chained mapped collection in a prop", () => {
    expectPass(`<Menu items={data?.map((d) => <MenuItem label={d.label} />)} />;`);
  });

  it("does not flag Array.from elements passed to a non-children prop", () => {
    expectPass(`<Grid cells={Array.from(rows, (row) => <Cell value={row} />)} />;`);
  });

  it("still flags an array literal in children position", () => {
    expectFail(`<Tabs>{[<Tab />, <Tab />]}</Tabs>;`);
  });

  it("still flags a mapped collection in children position", () => {
    expectFail(`<Menu>{data.map((d) => <MenuItem label={d.label} />)}</Menu>;`);
  });

  it("still flags an array literal passed via the explicit children attribute", () => {
    // `children={[...]}` IS `props.children`, which React does validate.
    expectFail(`<Tabs children={[<Tab />, <Tab />]} />;`);
  });

  it("still flags a DOM element array in children position", () => {
    expectFail(`<ul>{[<li />, <li />]}</ul>;`);
  });

  // Wrappers that pass the value straight through to the prop (`&&`, `||`,
  // ternary branches, parens, TS assertions) don't change that React never
  // key-validates a non-children prop, so they're exempt too.
  it("does not flag a logical-wrapped mapped collection in a prop", () => {
    expectPass(`<Menu items={data.length && data.map((d) => <MenuItem v={d} />)} />;`);
  });

  it("does not flag a ternary-branch mapped collection in a prop", () => {
    expectPass(`<Menu items={ready ? data.map((d) => <MenuItem v={d} />) : []} />;`);
  });

  it("does not flag a TS-asserted array literal in a prop", () => {
    expectPass(`<Menu items={[<Tab />, <Tab />] as ReactNode[]} />;`);
  });

  it("still flags a logical-wrapped mapped collection in children position", () => {
    expectFail(`<Menu>{data.length && data.map((d) => <MenuItem v={d} />)}</Menu>;`);
  });
});
