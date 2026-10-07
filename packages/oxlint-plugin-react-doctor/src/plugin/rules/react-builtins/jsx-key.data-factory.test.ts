import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxKey } from "./jsx-key.js";

describe("jsx-key data factories", () => {
  it.each([
    `export const examples = { data: () => [<Example />, <Example />] };`,
    `export const examples = { data: () => { return [<Example />]; } };`,
    `export const examples = { data() { return [<Example />]; } };`,
    `export const examples = { data: function () { return [<Example />]; } };`,
    `export const examples = { data: (enabled) => enabled ? [<Example />] : [<Example />] };`,
    `export const examples = { data: (enabled) => enabled && [<Example />] };`,
    `export const examples = { data: (enabled) => { if (enabled) return [<Example />]; return []; } };`,
    `export const examples = { data: (() => ([<Example />] as const)) } satisfies Catalog;`,
    `const examples = { data: () => [<Example />] }; export { examples };`,
    `const property = 'data'; export const examples = { [property]: () => [<Example />] };`,
    `export const examples = { data: () => [<><Example /></>] };`,
  ])("does not infer sibling rendering from an unreferenced factory: %s", (code) => {
    const result = runRule(jsxKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `const examples = { data: () => [<Example />] }; const Page = () => <main>{examples.data()}</main>;`,
    `const examples = { data: () => [<Example />] }; const alias = examples; const Page = () => alias.data();`,
    `const examples = { data: () => [<Example />] }; const { data } = examples; const Page = () => data();`,
    `const examples = { data: () => [<Example />] }; const Page = () => examples.data().map(item => item);`,
    `const examples = { data: () => [<Example />] }; const Page = () => <examples.data />;`,
    `export const examples = { Component: () => [<Example />] };`,
    `export const examples = { render: () => [<Example />] };`,
    `export const examples = { renderItem: () => [<Example />] };`,
    `export const examples = { data: function Component() { return [<Example />]; } };`,
    `export const examples = { get data() { return [<Example />]; } };`,
    `export const examples = { [getProperty()]: () => [<Example />] };`,
    `export const examples = { data: () => <main>{[<Example />]}</main> };`,
    `export const examples = { data: () => [<main>{[<Example />]}</main>] };`,
    `export const examples = { data: () => items.map(item => <Example item={item} />) };`,
    `const Page = () => [<Example />];`,
    `const Page = () => { const examples = { data: () => [<Example />] }; return <main />; };`,
    `export const examples = { data: () => render([<Example />]) };`,
    `export const examples = { data: () => { const Component = () => [<Example />]; return Component; } };`,
    `export const examples = { data: () => [<Example key="own" {...{ key: 'other' }} />] };`,
  ])("keeps warnings when the data-factory boundary is not established: %s", (code) => {
    const result = runRule(jsxKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
