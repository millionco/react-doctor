import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { htmlNoNestedInteractive } from "./html-no-nested-interactive.js";

describe("html-no-nested-interactive", () => {
  it("flags `<a>` directly inside another `<a>`", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `
      const Card = () => (
        <a href="/outer">
          <a href="/inner">Inner</a>
        </a>
      );
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`<a>`");
  });

  it("flags `<button>` nested deep inside another `<button>`", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `
      const Toolbar = () => (
        <button type="button">
          <span>
            <button type="button">Inner</button>
          </span>
        </button>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`<button>`");
  });

  it("does not flag a single `<a>`", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `
      const Link = () => <a href="/">Home</a>;
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `<button>` inside an unrelated `<a>` (different interactive type)", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `
      const ButtonInLink = () => (
        <a href="/details">
          <button type="button">Save</button>
        </a>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag adjacent siblings", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `
      const Pair = () => (
        <div>
          <a href="/a">A</a>
          <a href="/b">B</a>
        </div>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  // An interactive element passed as a PROP isn't nested inside the host
  // element — the prop boundary stops the ancestor walk.
  it("does not flag a `<button>` passed as a prop on an outer `<button>`", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const R = () => <button onClick={s}>Go<Tooltip trigger={<button aria-label="i">i</button>} /></button>;`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  // The explicit `children` prop IS a real DOM child — React renders
  // `<button children={<button/>} />` exactly like `<button><button/></button>`.
  it("flags a `<button>` passed via the explicit `children` prop of a `<button>`", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const R = () => <button children={<button>x</button>} />;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a `<button>` in a non-children prop inside a `children` prop value", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const R = () => <button children={<Tooltip trigger={<button>x</button>}>hint</Tooltip>} />;`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
