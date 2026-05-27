import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidComponentsReturnOnce } from "./solid-components-return-once.js";

describe("solid-components-return-once", () => {
  it("flags early return in component", () => {
    const result = runRule(
      solidComponentsReturnOnce,
      `function Comp() {
         if (loading) return <div>Loading</div>;
         return <div>Done</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("early return");
  });

  it("flags conditional expression in block body return", () => {
    const result = runRule(
      solidComponentsReturnOnce,
      `function Comp() {
         return loading ? <div>Loading</div> : <div>Done</div>;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("conditional return");
  });

  it("flags arrow expression body with ternary", () => {
    const result = runRule(
      solidComponentsReturnOnce,
      `const Comp = () => loading ? <div>Loading</div> : <div>Done</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("conditional return");
  });

  it("flags arrow expression body with && operator", () => {
    const result = runRule(
      solidComponentsReturnOnce,
      `const Comp = () => loading && <div>Loading</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag single JSX return", () => {
    const result = runRule(solidComponentsReturnOnce, `const Comp = () => <div>Hello</div>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag lowercase functions", () => {
    const result = runRule(
      solidComponentsReturnOnce,
      `const helper = () => loading ? <div>A</div> : <div>B</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag render prop callbacks", () => {
    const result = runRule(
      solidComponentsReturnOnce,
      `const Comp = () => <Show when={x}>{() => loading ? <A /> : <B />}</Show>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
