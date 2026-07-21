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

  it("does not flag a button inside an anchor because anchor descendants remain semantic", () => {
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

  it("flags a focusable link inside a button", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const Menu = () => <button type="button"><a href="/details">Details</a></button>;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a native control inside an explicit ARIA button", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const Menu = () => <div role="button" tabIndex={0}><input /></div>;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a native control inside a static template-literal ARIA button", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      "const Menu = () => <div role={`button`} tabIndex={0}><input /></div>;",
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses the first valid ARIA role token case-insensitively", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const Menu = () => <><div role="unknown button"><input /></div><div role="UNKNOWN BUTTON"><a href="/details">Details</a></div><div role="unknown region"><button type="button">Independent action</button></div></>;`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("preserves native semantics when every explicit role token is invalid", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const Menu = () => <button role="unknown future-role"><input /></button>;`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("honors source order around static and dynamic role spreads", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const Menu = ({ props }) => <><div {...props} role="unknown button"><input /></div><div role="button" {...props}><input /></div><div role="region" {...{ className: "landmark" }}><button type="button">Independent action</button></div></>;`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not infer a presentational-child role from a dynamic override", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const Menu = ({ role }) => <button role={role}><a href="/details">Details</a></button>;`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a custom component's role prop as rendered DOM", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const Menu = () => <Control role="button"><a href="/details">Details</a></Control>;`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a native control with negative tabindex inside a button", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const Menu = () => <button type="button"><a href="/details" tabIndex={-1}>Details</a></button>;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a CSS-hidden button revealed on hover inside a button", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const Card = () => (
        <button type="button" className="group">
          Open
          <button type="button" className="hidden group-hover:block">Delete</button>
        </button>
      );`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a disabled button inside a button", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const Card = () => <button type="button"><button type="button" disabled>Delete</button></button>;`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("leaves a hidden button inside a presentational ARIA role alone", () => {
    const result = runRule(
      htmlNoNestedInteractive,
      `const Graphic = () => <div role="img"><button type="button" hidden>Hidden metadata</button></div>;`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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
