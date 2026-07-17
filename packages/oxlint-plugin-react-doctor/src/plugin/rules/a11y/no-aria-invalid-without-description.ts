import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const FORM_CONTROL_TAG_NAMES = new Set(["input", "select", "textarea"]);

const isStaticallyInvalid = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) {
    return (
      attribute.value.value === "true" ||
      attribute.value.value === "grammar" ||
      attribute.value.value === "spelling"
    );
  }
  return Boolean(
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isNodeOfType(attribute.value.expression, "Literal") &&
    (attribute.value.expression.value === true || attribute.value.expression.value === "true"),
  );
};

export const noAriaInvalidWithoutDescription = defineRule({
  id: "no-aria-invalid-without-description",
  title: "Invalid control has no error description",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Connect an invalid control to its error text with aria-describedby or aria-errormessage.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !FORM_CONTROL_TAG_NAMES.has(resolveJsxElementType(node)) ||
        hasJsxSpreadAttribute(node.attributes)
      ) {
        return;
      }
      const invalidAttribute = getAuthoritativeJsxAttribute(node.attributes, "aria-invalid", false);
      if (!invalidAttribute || !isStaticallyInvalid(invalidAttribute)) return;
      if (
        findJsxAttribute(node.attributes, "aria-describedby") ||
        findJsxAttribute(node.attributes, "aria-errormessage")
      ) {
        return;
      }
      context.report({
        node: invalidAttribute,
        message:
          "This control is marked invalid but is not connected to explanatory error text. Reference the error with aria-describedby or aria-errormessage.",
      });
    },
  }),
});
