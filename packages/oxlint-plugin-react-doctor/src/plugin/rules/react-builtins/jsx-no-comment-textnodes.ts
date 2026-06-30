import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const MESSAGE =
  "Your users see this comment as text on the page because `//` & `/*` aren't hidden in JSX.";

// HTML elements that intentionally render their text content
// verbatim — `<code>//# chunkId=</code>`, `<pre>// build output</pre>`,
// `<kbd>Ctrl/Cmd</kbd>`, `<samp>// no errors</samp>`. Text inside
// these tags is meant to be literal; flagging `//` in their bodies
// is a guaranteed false positive.
const LITERAL_TEXT_TAGS: ReadonlySet<string> = new Set(["code", "pre", "kbd", "samp", "tt"]);

const hasCommentLikePattern = (text: string): boolean => {
  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("/*")) return true;
    // A line that trims to just `//` (or `// `) is an interpolated
    // separator glyph (`{used} // {total} GB`), not a `// comment` —
    // require some comment body after the slashes before flagging.
    if (trimmed.startsWith("//") && trimmed.slice(2).trim().length > 0) return true;
  }
  return false;
};

const isInsideLiteralTextTag = (node: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const openingName = ancestor.openingElement.name as EsTreeNode;
      if (isNodeOfType(openingName, "JSXIdentifier") && LITERAL_TEXT_TAGS.has(openingName.name)) {
        return true;
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// Port of `oxc_linter::rules::react::jsx_no_comment_textnodes`. Reports
// JSX text nodes whose lines start with `//` or `/*` — these aren't
// comments, they're rendered as literal text. Skips text inside
// `<code>`, `<pre>`, `<kbd>`, `<samp>`, `<tt>` — those tags exist to
// render literal text including code-comment-like prefixes.
export const jsxNoCommentTextnodes = defineRule({
  id: "jsx-no-comment-textnodes",
  title: "Comment rendered as JSX text",
  severity: "warn",
  recommendation:
    "Wrap JSX comments in `{/* … */}` so users do not see comment text rendered as children.",
  create: (context) => ({
    JSXText(node: EsTreeNodeOfType<"JSXText">) {
      if (!hasCommentLikePattern(node.value)) return;
      if (isInsideLiteralTextTag(node)) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
