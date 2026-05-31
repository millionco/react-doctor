import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const buildMessage = (tagName: string): string =>
  `Your users get broken clicks, focus & screen readers because you can't put a \`<${tagName}>\` inside another \`<${tagName}>\`, so the browser closes the outer one early. Move the inner one out.`;

const isJsxElementWithTagName = (
  candidate: EsTreeNode,
  tagName: string,
): candidate is EsTreeNodeOfType<"JSXElement"> => {
  if (!isNodeOfType(candidate, "JSXElement")) return false;
  const opening = candidate.openingElement;
  if (!isNodeOfType(opening.name, "JSXIdentifier")) return false;
  return opening.name.name === tagName;
};

// `node.parent` of a JSXOpeningElement is the JSXElement that owns it
// (i.e. itself), so the ancestor walk has to start from the grandparent
// to avoid matching the element against its own opening tag.
//
// Walks straight through user-component boundaries (same trade-off
// reasoning as `html-no-invalid-paragraph-child`'s `findEnclosingParagraph`):
// the constraint here is "no same-type interactive ancestor anywhere
// up the tree", and components don't typically inject `<a>` or
// `<button>` around their children. Bailing on components would
// silence the dominant true-positive shape (`<a><Wrapper><a/></Wrapper></a>`
// where `Wrapper` passes children through). Compare with
// `html-no-invalid-table-nesting`, which bails because table elements
// have direct-parent constraints that components routinely satisfy.
const findEnclosingSameTag = (openingElement: EsTreeNode, tagName: string): EsTreeNode | null => {
  const owningElement = openingElement.parent;
  if (!owningElement) return null;
  let ancestor: EsTreeNode | null | undefined = owningElement.parent;
  while (ancestor) {
    if (isJsxElementWithTagName(ancestor, tagName)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// Mirrors the runtime check in `preact/debug/src/debug.js`:
//   if (getDomChildren(vnode).indexOf(type) !== -1) {
//     console.error(`Improper nesting of interactive content. ...`);
//   }
// for `<a>` and `<button>`. The HTML spec forbids interactive content
// (anchors, buttons) from nesting same-type interactive content. Browsers
// silently auto-close the outer element when they encounter the inner one,
// producing a DOM tree that doesn't match the JSX you wrote — events fire
// on the wrong element, focus order breaks, and screen readers surface
// duplicate or split landmarks. Restricted to in-component JSX ancestry
// (the rule cannot see the <a>-wrapping ancestor when an <a> is rendered
// in a child component); preact/debug catches the cross-component case at
// runtime via the live VNode tree.
export const htmlNoNestedInteractive = defineRule<Rule>({
  id: "html-no-nested-interactive",
  title: "Nested interactive elements",
  severity: "warn",
  recommendation:
    "Move the inner `<a>` or `<button>` so it's a sibling, or change the outer one to a plain `<div>` or `<span>`.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const tagName = node.name.name;
      if (tagName !== "a" && tagName !== "button") return;
      const enclosingElement = findEnclosingSameTag(node, tagName);
      if (!enclosingElement) return;
      context.report({ node: node.name, message: buildMessage(tagName) });
    },
  }),
});
