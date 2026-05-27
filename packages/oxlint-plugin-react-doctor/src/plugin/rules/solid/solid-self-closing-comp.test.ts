import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidSelfClosingComp } from "./solid-self-closing-comp.js";

describe("solid-self-closing-comp", () => {
  it("flags empty component with closing tag", () => {
    const result = runRule(solidSelfClosingComp, `const Foo = () => <MyComp></MyComp>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("self-closing");
  });

  it("flags empty HTML element with closing tag", () => {
    const result = runRule(solidSelfClosingComp, `const Foo = () => <div></div>;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("self-closing");
  });

  it("flags component with only whitespace children", () => {
    const result = runRule(
      solidSelfClosingComp,
      `const Foo = () => <MyComp>
</MyComp>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag component with actual children", () => {
    const result = runRule(solidSelfClosingComp, `const Foo = () => <MyComp>content</MyComp>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag already self-closed component", () => {
    const result = runRule(solidSelfClosingComp, `const Foo = () => <MyComp />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag already self-closed HTML element", () => {
    const result = runRule(solidSelfClosingComp, `const Foo = () => <div />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags empty void HTML element with closing tag", () => {
    const result = runRule(solidSelfClosingComp, `const Foo = () => <img></img>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag element with JSX expression children", () => {
    const result = runRule(solidSelfClosingComp, `const Foo = () => <div>{value}</div>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags member expression component with no children", () => {
    const result = runRule(solidSelfClosingComp, `const Foo = () => <Ns.Bar></Ns.Bar>;`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
