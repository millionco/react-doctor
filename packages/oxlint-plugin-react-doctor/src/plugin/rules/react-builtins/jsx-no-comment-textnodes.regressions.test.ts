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

  // An actual stray `// comment` line as a JSX child still renders as
  // text and must fire.
  it("still flags a stray `// comment` JSX child", () => {
    const result = runRule(jsxNoCommentTextnodes, `<div>// invalid</div>`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
