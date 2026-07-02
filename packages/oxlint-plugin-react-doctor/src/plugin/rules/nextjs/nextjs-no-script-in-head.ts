import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isHeadElement = (candidate: EsTreeNode): boolean =>
  isNodeOfType(candidate, "JSXElement") &&
  isNodeOfType(candidate.openingElement.name, "JSXIdentifier") &&
  candidate.openingElement.name.name === "Head";

// A `<Script>` passed as a PROP of `<Head>` (`<Head icon={<Script/>}>`) is not
// a DOM child of head, so it isn't silently ignored — stop the ancestor walk
// at the attribute boundary, mirroring html-no-nested-interactive.
const isInsideHeadElement = (openingElement: EsTreeNode): boolean => {
  const owningElement = openingElement.parent;
  if (!owningElement) return false;
  let ancestor: EsTreeNode | null | undefined = owningElement.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXAttribute")) return false;
    if (isHeadElement(ancestor)) return true;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

export const nextjsNoScriptInHead = defineRule({
  id: "nextjs-no-script-in-head",
  title: "next/script inside next/head",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "error",
  recommendation:
    "Move `<Script>` outside of `<Head>`. next/script manages its own placement and ignores head context",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "Script") return;
      if (!isInsideHeadElement(node)) return;

      context.report({
        node,
        message:
          "next/script inside next/head is silently ignored. Move <Script> outside <Head> so it actually loads.",
      });
    },
  }),
});
