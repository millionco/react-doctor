import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

// Lifted verbatim from `preact/debug/src/debug.js`'s
// `ILLEGAL_PARAGRAPH_CHILD_ELEMENTS` regex. These are the block-level
// HTML elements whose presence inside a `<p>` causes the browser parser
// to auto-close the paragraph at the start of the offending child,
// because `<p>`'s content model permits phrasing content only.
const BLOCK_LEVEL_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "search",
  "section",
  "table",
  "ul",
]);

const buildMessage = (childTagName: string): string =>
  `Block-level \`<${childTagName}>\` cannot appear inside a \`<p>\` — the HTML parser auto-closes the paragraph at the start of \`<${childTagName}>\`, splitting your DOM in ways the renderer never expressed and triggering hydration mismatches.`;

const isParagraphElement = (candidate: EsTreeNode): boolean => {
  if (!isNodeOfType(candidate, "JSXElement")) return false;
  const opening = candidate.openingElement;
  if (!isNodeOfType(opening.name, "JSXIdentifier")) return false;
  return opening.name.name === "p";
};

// `node.parent` of a JSXOpeningElement is the JSXElement that owns it
// (i.e. itself), so the ancestor walk has to start from the grandparent
// to avoid matching `<p>` against its own opening tag.
//
// Walks straight through user-component boundaries (unlike
// `html-no-invalid-table-nesting`, which bails out on opaque
// ancestors). The constraints have different shapes:
//
//   - Table nesting: "DIRECT host parent must be X". A component
//     intervening between `<tr>` and the inner element routinely
//     renders the right structural wrapper (e.g. `<TableCell>` →
//     `<td>`), so the static walk's conclusion is usually wrong.
//
//   - Paragraph nesting: "no `<p>` ancestor anywhere up the tree".
//     Components don't typically inject a `<p>` around their
//     children, so an intervening `<MyContent>` rarely changes
//     whether a `<p>` ancestor exists at runtime. The dominant
//     composition pattern (`<p><Wrapper><div/></Wrapper></p>` where
//     `Wrapper = ({children}) => children` or wraps in an inline
//     element) IS a true positive. Bailing on components would
//     silence almost every real bug.
//
// The narrow false-positive case (`<MyContent>` discards children or
// renders into a portal) is too rare to justify the precision loss.
const findEnclosingParagraph = (openingElement: EsTreeNode): EsTreeNode | null => {
  const owningElement = openingElement.parent;
  if (!owningElement) return null;
  let ancestor: EsTreeNode | null | undefined = owningElement.parent;
  while (ancestor) {
    if (isParagraphElement(ancestor)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// Mirrors the runtime check in `preact/debug/src/debug.js`:
//   } else if (type === 'p') {
//     let illegalDomChildrenTypes = getDomChildren(vnode).filter(childType =>
//       ILLEGAL_PARAGRAPH_CHILD_ELEMENTS.test(childType)
//     );
//     if (illegalDomChildrenTypes.length) console.error(...);
//   }
// `<p>` permits phrasing content only; block elements force the parser to
// implicitly close the paragraph. The result is a DOM tree that doesn't
// match what the JSX expressed — hydration mismatches, broken styling
// selectors, and accessibility tree corruption all follow.
export const htmlNoInvalidParagraphChild = defineRule<Rule>({
  id: "html-no-invalid-paragraph-child",
  severity: "warn",
  recommendation:
    "Replace the surrounding `<p>` with a `<div>`, or hoist the block-level child outside the paragraph.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const childTagName = node.name.name;
      if (!BLOCK_LEVEL_ELEMENTS.has(childTagName)) return;
      const enclosingParagraph = findEnclosingParagraph(node);
      if (!enclosingParagraph) return;
      context.report({ node: node.name, message: buildMessage(childTagName) });
    },
  }),
});
