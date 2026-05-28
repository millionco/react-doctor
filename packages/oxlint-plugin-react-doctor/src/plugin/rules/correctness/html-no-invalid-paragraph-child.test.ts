import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { htmlNoInvalidParagraphChild } from "./html-no-invalid-paragraph-child.js";

describe("html-no-invalid-paragraph-child", () => {
  it("flags `<div>` inside `<p>`", () => {
    const result = runRule(
      htmlNoInvalidParagraphChild,
      `
      const Card = () => (
        <p>
          <div>oops</div>
        </p>
      );
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`<div>`");
  });

  it("flags `<table>` inside `<p>`", () => {
    const result = runRule(
      htmlNoInvalidParagraphChild,
      `
      const Card = () => (
        <p>
          <table>
            <tr><td>x</td></tr>
          </table>
        </p>
      );
      `,
    );

    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics[0].message).toContain("`<table>`");
  });

  it("flags a nested `<p>` inside `<p>`", () => {
    const result = runRule(
      htmlNoInvalidParagraphChild,
      `
      const Card = () => (
        <p>
          intro
          <p>nested</p>
        </p>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`<p>`");
  });

  it("flags a deeply nested block element inside `<p>`", () => {
    const result = runRule(
      htmlNoInvalidParagraphChild,
      `
      const Card = () => (
        <p>
          <span>
            <strong>
              <ul><li>x</li></ul>
            </strong>
          </span>
        </p>
      );
      `,
    );

    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag inline phrasing elements inside `<p>`", () => {
    const result = runRule(
      htmlNoInvalidParagraphChild,
      `
      const Card = () => (
        <p>
          plain <em>emphasis</em> and <strong>bold</strong> with a <a href="/">link</a>.
        </p>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `<div>` outside any paragraph", () => {
    const result = runRule(
      htmlNoInvalidParagraphChild,
      `
      const Card = () => (
        <section>
          <div>fine</div>
        </section>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
