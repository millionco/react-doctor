import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidPreferFor } from "./solid-prefer-for.js";

describe("solid-prefer-for", () => {
  it("flags Array#map inside JSX", () => {
    const result = runRule(
      solidPreferFor,
      `const Foo = () => <div>{items.map((item) => <span>{item}</span>)}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<For");
  });

  it("does not flag Array#map outside JSX", () => {
    const result = runRule(
      solidPreferFor,
      `const Foo = () => { const mapped = items.map((item) => item * 2); return <div>{mapped[0]}</div>; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
