import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const LABELABLE_TAG_NAMES = new Set([
  "button",
  "input",
  "meter",
  "output",
  "progress",
  "select",
  "textarea",
]);

export const htmlLabelHasSingleControl = defineRule({
  id: "html-label-has-single-control",
  title: "Label wraps multiple native controls",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Associate each label with one native control; use fieldset and legend to name a group of controls.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (resolveJsxElementType(node.openingElement) !== "label") return;
      const controls = getStaticJsxDescendantOpeningElements(node).filter((descendant) =>
        LABELABLE_TAG_NAMES.has(resolveJsxElementType(descendant)),
      );
      if (controls.length < 2) return;
      context.report({
        node: node.openingElement,
        message:
          "This label contains multiple native controls, but a label can identify only one control. Split the labels or name the group with fieldset and legend.",
      });
    },
  }),
});
