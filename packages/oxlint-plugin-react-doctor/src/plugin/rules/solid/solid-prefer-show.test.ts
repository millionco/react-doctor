import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidPreferShow } from "./solid-prefer-show.js";

describe("solid-prefer-show", () => {
  it("flags logical && with JSX element on the right", () => {
    const result = runRule(
      solidPreferShow,
      `const Foo = () => <div>{visible && <span>hi</span>}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<Show />");
  });

  it("flags logical && with identifier on the right", () => {
    const result = runRule(solidPreferShow, `const Foo = () => <div>{visible && Component}</div>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags logical && with JSX fragment on the right", () => {
    const result = runRule(
      solidPreferShow,
      `const Foo = () => <div>{visible && <><span /><span /></>}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags ternary with JSX element in consequent", () => {
    const result = runRule(
      solidPreferShow,
      `const Foo = () => <div>{ok ? <span>yes</span> : "no"}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("fallback");
  });

  it("flags ternary with JSX element in alternate", () => {
    const result = runRule(
      solidPreferShow,
      `const Foo = () => <div>{ok ? "yes" : <span>no</span>}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags arrow function body with logical && expression", () => {
    const result = runRule(
      solidPreferShow,
      `const Foo = () => <div>{() => visible && <span />}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags arrow function body with ternary expression", () => {
    const result = runRule(
      solidPreferShow,
      `const Foo = () => <div>{() => ok ? <span /> : <em />}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag logical && with non-expensive right side", () => {
    const result = runRule(solidPreferShow, `const Foo = () => <div>{visible && "text"}</div>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ternary with no JSX on either side", () => {
    const result = runRule(solidPreferShow, `const Foo = () => <div>{ok ? "yes" : "no"}</div>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag logical || operator", () => {
    const result = runRule(
      solidPreferShow,
      `const Foo = () => <div>{visible || <span>fallback</span>}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag expression outside JSX", () => {
    const result = runRule(solidPreferShow, `const val = ok && <span />;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
