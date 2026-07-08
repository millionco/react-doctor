import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoCommentTextnodes } from "./jsx-no-comment-textnodes.js";

describe("react-builtins/jsx-no-comment-textnodes — regressions", () => {
  // `{used} // {total} GB` — the `" // "` text node is an interpolated
  // separator glyph, not a `// comment`. It trims to just `//` with no
  // body, so it must not be flagged.
  it("stays silent on a `//` separator between expression containers", () => {
    const result = runRule(
      jsxNoCommentTextnodes,
      `function Stat({ used, total }) { return <div>{used} // {total} GB</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // fp-review PR991: the same separator idiom with a LITERAL right side —
  // `{used} // 512 GB` — is deliberate rendered text continuing the
  // preceding expression, not a stray comment.
  it("stays silent on a `//` separator with a literal right side", () => {
    const result = runRule(
      jsxNoCommentTextnodes,
      `function Stat({ used }) { return <div>{used} // 512 GB</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Only a digit-leading right side reads as a value continuation —
  // prose after the slashes is a real stray comment and must still fire.
  it("still flags prose `//` text after an expression container", () => {
    const result = runRule(
      jsxNoCommentTextnodes,
      `function Note({ value }) { return <div>{value} // visible to users</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Only the FIRST line continues the expression — a later line starting
  // with `//` is a fresh stray comment and must still fire.
  it("still flags a `//` line after the separator line", () => {
    const result = runRule(
      jsxNoCommentTextnodes,
      `function Stat({ used }) { return <div>{used} // 512 GB
      // stray comment
      </div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // A `{/* comment */}` container emits no runtime content, so text after
  // it is not continuing an interpolated value — still a stray comment.
  it("still flags `//` text after a JSX comment container", () => {
    const result = runRule(jsxNoCommentTextnodes, `<div>{/* note */} // invalid</div>`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // An actual stray `// comment` line as a JSX child still renders as
  // text and must fire.
  it("still flags a stray `// comment` JSX child", () => {
    const result = runRule(jsxNoCommentTextnodes, `<div>// invalid</div>`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // docs-validation 2026-07: syntax-highlight theme previews render a
  // comment token as the sole text of a styled span — deliberate
  // on-screen copy, the doc's explicit FP example.
  it("stays silent on a styled span rendering a highlighted comment token", () => {
    const result = runRule(
      jsxNoCommentTextnodes,
      `const Preview = ({ p }) => (
        <div style={{ background: p.bg }} className="font-mono">
          <span style={{ color: p.keyword }}>const</span>
          <br />
          <span style={{ color: p.comment }}>// comment</span>
        </div>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // docs-validation 2026-07: terminal-aesthetic UI copy — `// event_log`
  // as the sole text of a classed div is intentional display text.
  it("stays silent on terminal-aesthetic comment copy in a classed div", () => {
    const result = runRule(
      jsxNoCommentTextnodes,
      `const Panel = () => <div className="text-gray-500 text-xs mb-1">// event_log</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // The sole-child-of-styled-element carve-out must not swallow genuine
  // stray comments that sit among other children of a styled wrapper.
  it("still flags a stray comment line among siblings of a classed div", () => {
    const result = runRule(
      jsxNoCommentTextnodes,
      `const App = () => (
        <div className="wrapper">
          // TODO remove this
          <Child />
        </div>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a sole-child comment in an unstyled element", () => {
    const result = runRule(jsxNoCommentTextnodes, `<div>// forgot the braces</div>`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
