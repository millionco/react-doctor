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

  it("allows static innerHTML on childless element by default", () => {
    const result = runRule(solidNoInnerHtml, `const Foo = () => <div innerHTML="<b>safe</b>" />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags static innerHTML when allowStatic is false", () => {
    const result = runRule(
      solidNoInnerHtml,
      `const Foo = () => <div innerHTML="<b>hello</b>" />;`,
      { settings: { "react-doctor": { solidNoInnerHtml: { allowStatic: false } } } },
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("static values");
  });

  it("flags innerHTML with template literal containing expressions as dynamic", () => {
    const result = runRule(
      solidNoInnerHtml,
      "const Foo = ({ input }) => <div innerHTML={`<p>${input}</p>`} />;",
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("dynamic");
  });

  it("flags innerHTML with function call value as dynamic", () => {
    const result = runRule(solidNoInnerHtml, `const Foo = () => <div innerHTML={getHtml()} />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("dynamic");
  });

  it("allows static innerHTML on self-closing element with no children", () => {
    const result = runRule(solidNoInnerHtml, `const Foo = () => <span innerHTML="<b>ok</b>" />;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
