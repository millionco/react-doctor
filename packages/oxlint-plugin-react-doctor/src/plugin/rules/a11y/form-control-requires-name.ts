import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const FORM_CONTROL_TAG_NAMES = new Set(["input", "select", "textarea"]);
const NON_DATA_INPUT_TYPES = new Set(["button", "image", "reset", "submit"]);

const hasFormAncestor = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      if (resolveJsxElementType(ancestor.openingElement) === "form") return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const formControlRequiresName = defineRule({
  id: "form-control-requires-name",
  title: "Form control is omitted from named submission data",
  severity: "warn",
  category: "Correctness",
  defaultEnabled: false,
  recommendation:
    "Give each data-bearing native control inside a form a stable name for FormData, autofill, and non-JavaScript submission.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tagName = resolveJsxElementType(node);
      if (
        !FORM_CONTROL_TAG_NAMES.has(tagName) ||
        hasJsxSpreadAttribute(node.attributes) ||
        !hasFormAncestor(node)
      ) {
        return;
      }
      if (tagName === "input") {
        const typeAttribute = findJsxAttribute(node.attributes, "type");
        if (typeAttribute) {
          const inputType = getStringLiteralAttributeValue(typeAttribute);
          if (inputType === null || NON_DATA_INPUT_TYPES.has(inputType.toLowerCase())) return;
        }
      }
      const nameAttribute = findJsxAttribute(node.attributes, "name");
      if (nameAttribute) return;
      context.report({
        node,
        message:
          "This native control is inside a form but has no name, so FormData and native submission omit its value. Add a stable name.",
      });
    },
  }),
});
