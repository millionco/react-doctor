import { defineRule } from "../../utils/define-rule.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const TEXT_INPUT_TYPES = new Set(["email", "number", "password", "search", "tel", "text", "url"]);

const getOpeningElementName = (node: EsTreeNodeOfType<"JSXOpeningElement">): string | null =>
  isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : null;

const isNestedInLabel = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      getOpeningElementName(ancestor.openingElement) === "label"
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const noPlaceholderOnlyField = defineRule({
  id: "no-placeholder-only-field",
  title: "Field relies on placeholder text for its label",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Add a visible label associated with the field. Keep placeholder text for examples or formatting hints.",
  create: (context: RuleContext) => {
    const labelledControlIds = new Set<string>();
    const fieldCandidates: Array<{
      id: string | null;
      node: EsTreeNodeOfType<"JSXOpeningElement">;
    }> = [];

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementName = getOpeningElementName(node);
        if (elementName === "label") {
          const htmlForAttribute =
            hasJsxPropIgnoreCase(node.attributes, "htmlFor") ??
            hasJsxPropIgnoreCase(node.attributes, "for");
          if (!htmlForAttribute) return;
          const htmlForValue = getStringLiteralAttributeValue(htmlForAttribute)?.trim();
          if (htmlForValue) labelledControlIds.add(htmlForValue);
          return;
        }

        if (elementName !== "input" && elementName !== "textarea") return;
        if (hasJsxSpreadAttribute(node.attributes)) return;
        if (isNestedInLabel(node)) return;
        if (
          hasJsxPropIgnoreCase(node.attributes, "aria-label") ||
          hasJsxPropIgnoreCase(node.attributes, "aria-labelledby")
        ) {
          return;
        }

        if (elementName === "input") {
          const typeAttribute = hasJsxPropIgnoreCase(node.attributes, "type");
          const inputType = typeAttribute
            ? getJsxPropStringValue(typeAttribute)?.toLowerCase()
            : "text";
          if (inputType && !TEXT_INPUT_TYPES.has(inputType)) return;
        }

        const placeholderAttribute = hasJsxPropIgnoreCase(node.attributes, "placeholder");
        if (!placeholderAttribute) return;
        const placeholderValue = getStringLiteralAttributeValue(placeholderAttribute)?.trim();
        if (!placeholderValue) return;

        const idAttribute = hasJsxPropIgnoreCase(node.attributes, "id");
        const idValue = idAttribute ? getStringLiteralAttributeValue(idAttribute)?.trim() : null;
        if (idAttribute && !idValue) return;
        fieldCandidates.push({ id: idValue || null, node });
      },
      "Program:exit"() {
        for (const candidate of fieldCandidates) {
          if (candidate.id && labelledControlIds.has(candidate.id)) continue;
          context.report({
            node: candidate.node,
            message:
              "Placeholder text disappears during entry and cannot replace a persistent field label. Add a visible associated label.",
          });
        }
      },
    };
  },
});
