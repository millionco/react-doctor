import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkJsxElementName } from "../../utils/resolve-ink-api-name.js";

const NON_APPEND_COLLECTION_METHODS = new Set(["reverse", "sort", "toReversed", "toSorted"]);

export const inkStaticIsAppendOnly = defineRule({
  id: "ink-static-is-append-only",
  title: "Static receives a non-append-only collection",
  severity: "warn",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Pass `<Static>` a collection whose existing entries never reorder or disappear.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (resolveInkJsxElementName(node, context.scopes) !== "Static") return;
      const itemsAttribute = findJsxAttribute(node.attributes, "items");
      if (!itemsAttribute || !isNodeOfType(itemsAttribute.value, "JSXExpressionContainer")) return;
      const expression = itemsAttribute.value.expression;
      if (
        !isNodeOfType(expression, "CallExpression") ||
        !isNodeOfType(expression.callee, "MemberExpression")
      ) {
        return;
      }
      const methodName = getStaticPropertyName(expression.callee);
      if (!methodName || !NON_APPEND_COLLECTION_METHODS.has(methodName)) return;
      if (
        isNodeOfType(expression.callee.object, "ArrayExpression") &&
        expression.callee.object.elements.every(
          (elementNode) =>
            elementNode === null ||
            isNodeOfType(elementNode, "Literal") ||
            (isNodeOfType(elementNode, "TemplateLiteral") && elementNode.expressions.length === 0),
        )
      ) {
        return;
      }
      context.report({
        node: itemsAttribute,
        message: `\`<Static>\` never revises prior output, but \`.${methodName}()\` can change existing item order.`,
      });
    },
  }),
});
