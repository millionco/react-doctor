import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const CONTROLLED_INPUT_TAGS = new Set(["input", "textarea"]);

// `checked` drives radio/checkbox state, `hidden` never needs onChange, so a
// literal `value` on these is the submission token, not a frozen field.
const VALUE_BYPASS_INPUT_TYPES = new Set(["hidden", "checkbox", "radio"]);

const READONLY_ATTRIBUTES = ["readOnly", "disabled"];

// True when the `value` JSXAttribute is a bare string/number literal —
// `value="x"` or `value={123}`. Identifier references (state, props, consts)
// are deliberately excluded: telling them apart needs scope analysis, and the
// applied revision keeps this detector syntax-only to avoid the prop FP.
const isLiteralValueAttribute = (valueAttribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value = valueAttribute.value;
  if (!value) return false;
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "string" || typeof value.value === "number";
  }
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression: EsTreeNode = stripParenExpression(value.expression);
    return (
      isNodeOfType(expression, "Literal") &&
      (typeof expression.value === "string" || typeof expression.value === "number")
    );
  }
  return false;
};

// Mirrors `isLiteralValueAttribute`'s two accepted shapes for the `type`
// attribute: `type="radio"` and `type={"radio"}` both resolve statically.
const getStaticStringAttributeValue = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): string | null => {
  const value = attribute.value;
  if (!value) return null;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") return value.value;
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression: EsTreeNode = stripParenExpression(value.expression);
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return expression.value;
    }
  }
  return null;
};

export const noControlledInputValueWithoutStateUpdate = defineRule({
  id: "no-controlled-input-value-without-state-update",
  title: "Controlled input value is a fixed literal",
  severity: "warn",
  tags: ["react-jsx-only"],
  recommendation:
    "Drive the input's `value` from state (`const [value, setValue] = useState(...)`) that `onChange` updates, or drop `value` if the field is meant to be read-only.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      const tagName = node.name.name;
      if (!CONTROLLED_INPUT_TAGS.has(tagName)) return;

      const attributes = node.attributes ?? [];
      if (hasJsxSpreadAttribute(attributes)) return;

      const valueAttribute = findJsxAttribute(attributes, "value");
      if (!valueAttribute || !isLiteralValueAttribute(valueAttribute)) return;

      if (!findJsxAttribute(attributes, "onChange")) return;
      if (READONLY_ATTRIBUTES.some((name) => findJsxAttribute(attributes, name))) return;

      if (tagName === "input") {
        if (findJsxAttribute(attributes, "checked")) return;
        const typeAttribute = findJsxAttribute(attributes, "type");
        if (typeAttribute) {
          const inputType = getStaticStringAttributeValue(typeAttribute);
          if (inputType === null || VALUE_BYPASS_INPUT_TYPES.has(inputType)) return;
        }
      }

      context.report({
        node,
        message: `Typing does nothing in this <${tagName}> because its \`value\` is a fixed literal that \`onChange\` never updates, so drive \`value\` from state or drop it if the field should be read-only.`,
      });
    },
  }),
});
