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

  it("flags nested .map() calls inside JSX separately", () => {
    const result = runRule(
      solidPreferFor,
      `const Foo = () => <ul>{groups.map((group) => <li>{group.items.map((item) => <span>{item}</span>)}</li>)}</ul>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("suggests <Index /> when callback uses index parameter", () => {
    const result = runRule(
      solidPreferFor,
      `const Foo = () => <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<Index />");
  });

  it("does not flag .map() with non-function argument", () => {
    const result = runRule(
      solidPreferFor,
      `const Foo = () => <div>{items.map(transformFn)}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
