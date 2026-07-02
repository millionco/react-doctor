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
});
