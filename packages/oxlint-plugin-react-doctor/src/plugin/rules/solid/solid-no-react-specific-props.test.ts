import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoReactSpecificProps } from "./solid-no-react-specific-props.js";

describe("solid-no-react-specific-props", () => {
  it("flags className on a DOM element", () => {
    const result = runRule(solidNoReactSpecificProps, `const Foo = () => <div className="x" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("class");
  });

  it("flags htmlFor on a DOM element", () => {
    const result = runRule(
      solidNoReactSpecificProps,
      `const Foo = () => <label htmlFor="email" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("for");
  });

  it("flags `key` on a DOM element", () => {
    const result = runRule(solidNoReactSpecificProps, `const Foo = () => <div key="x" />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("key");
  });

  it("does not flag `class` or `for`", () => {
    const result = runRule(
      solidNoReactSpecificProps,
      `const Foo = () => <label for="email" class="x" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag className on a custom component", () => {
    const result = runRule(
      solidNoReactSpecificProps,
      `const Foo = () => <MyWidget className="x" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag key on a custom component", () => {
    const result = runRule(solidNoReactSpecificProps, `const Foo = () => <MyList key="id" />;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
