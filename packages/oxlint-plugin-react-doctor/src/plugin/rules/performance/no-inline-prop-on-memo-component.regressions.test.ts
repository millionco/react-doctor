import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInlinePropOnMemoComponent } from "./no-inline-prop-on-memo-component.js";

describe("performance/no-inline-prop-on-memo-component — regressions", () => {
  it("stays silent when memo has a custom comparator", () => {
    const result = runRule(
      noInlinePropOnMemoComponent,
      `const Row = memo(Inner, (a, b) => a.id === b.id); function List() { return <Row id={1} onClick={() => doThing()} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags inline props on a default memo component", () => {
    const result = runRule(
      noInlinePropOnMemoComponent,
      `const Row = memo(Inner); function List() { return <Row id={1} onClick={() => doThing()} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an inline ref callback on a default memo component (ref identity gates the memo bailout)", () => {
    const result = runRule(
      noInlinePropOnMemoComponent,
      `const Row = memo(Inner); function List() { return <Row ref={(el) => track(el)} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on an inline key prop", () => {
    const result = runRule(
      noInlinePropOnMemoComponent,
      `const Row = memo(Inner); function List({ items }) { return items.map((item) => <Row key={[item.id]} />); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags inline props when the comparator is the shallowEqual identifier (default-equivalent)", () => {
    const result = runRule(
      noInlinePropOnMemoComponent,
      `import { shallowEqual } from "react-redux";
const Row = memo(Inner, shallowEqual);
function List() { return <Row onClick={() => doThing()} style={{ color: "red" }} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags inline props when the comparator is an explicit undefined (React falls back to shallow compare)", () => {
    const result = runRule(
      noInlinePropOnMemoComponent,
      `const Row = memo(Inner, undefined); function List() { return <Row onClick={() => doThing()} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when export default memo(Inner, customCompare) has a real comparator", () => {
    const result = runRule(
      noInlinePropOnMemoComponent,
      `function Inner(props) { return null; }
export default memo(Inner, (a, b) => a.id === b.id);
export function List() { return <Inner onClick={() => doThing()} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
