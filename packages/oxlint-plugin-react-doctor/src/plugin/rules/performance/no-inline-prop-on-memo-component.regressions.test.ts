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
});
