import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidNoInnerHtml } from "./solid-no-innerhtml.js";

describe("solid-no-innerhtml", () => {
  it("flags dynamic innerHTML", () => {
    const result = runRule(solidNoInnerHtml, `const Foo = ({ html }) => <div innerHTML={html} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("innerHTML");
  });

  it("flags dangerouslySetInnerHTML", () => {
    const result = runRule(
      solidNoInnerHtml,
      `const Foo = () => <div dangerouslySetInnerHTML={{ __html: "x" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("dangerouslySetInnerHTML");
  });

  it("flags innerHTML on an element with children", () => {
    const result = runRule(
      solidNoInnerHtml,
      `const Foo = () => <div innerHTML="<p>x</p>"><span /></div>;`,
    );
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("overwritten")),
    ).toBe(true);
  });
});
