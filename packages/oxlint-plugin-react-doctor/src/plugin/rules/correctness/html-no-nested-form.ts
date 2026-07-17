import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const isFormElement = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "JSXOpeningElement") && resolveJsxElementType(node) === "form";

const hasFormAncestor = (node: EsTreeNode): boolean => {
  let ancestor = node.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement") && isFormElement(ancestor.openingElement)) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const htmlNoNestedForm = defineRule({
  id: "html-no-nested-form",
  title: "Form nested inside another form",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Keep forms separate, or make the inner action a button associated with the outer form. HTML does not permit form descendants inside a form.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isFormElement(node) || !hasFormAncestor(node)) return;
      context.report({
        node,
        message:
          "This form is nested inside another form, which is invalid HTML and can make controls submit through the wrong form. Separate the forms.",
      });
    },
  }),
});
