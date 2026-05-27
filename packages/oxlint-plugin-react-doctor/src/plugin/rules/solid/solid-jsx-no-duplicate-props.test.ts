import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidJsxNoDuplicateProps } from "./solid-jsx-no-duplicate-props.js";

describe("solid-jsx-no-duplicate-props", () => {
  it("flags duplicate props", () => {
    const result = runRule(solidJsxNoDuplicateProps, `const Foo = () => <div id="a" id="b" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses class-specific message", () => {
    const result = runRule(
      solidJsxNoDuplicateProps,
      `const Foo = () => <div class="a" class="b" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("classList");
  });

  it("does not flag distinct props", () => {
    const result = runRule(solidJsxNoDuplicateProps, `const Foo = () => <div id="a" class="b" />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags children-prop + JSX children conflict", () => {
    const result = runRule(
      solidJsxNoDuplicateProps,
      `const Foo = () => <div children={"x"}>hello</div>;`,
    );
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("JSX children")),
    ).toBe(true);
  });
});
