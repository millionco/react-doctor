import { RENDER_ITEM_PROP_NAMES } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: inside `renderItem`, JSX prop values that are object literals
// (`style={{...}}`, `user={{...}}`, etc.) allocate a fresh object
// reference per row. Any `memo()`-wrapped row component bails its
// shallow-compare for that prop and rerenders even when the underlying
// data didn't change. Hoist the object outside renderItem (StyleSheet,
// constant, useMemo at list scope) or pass primitives into the row.
export const rnNoInlineObjectInListItem = defineRule<Rule>({
  id: "rn-no-inline-object-in-list-item",
  title: "Inline object in list renderItem",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Move style and object props out of renderItem (StyleSheet.create, useMemo at list scope, or pass primitives) so memo() rows stop redrawing when their data has not changed.",
  create: (context: RuleContext) => {
    const renderPropStack: string[] = [];

    const resolveRenderPropName = (node: EsTreeNode): string | null => {
      if (
        !isNodeOfType(node, "ArrowFunctionExpression") &&
        !isNodeOfType(node, "FunctionExpression")
      ) {
        return null;
      }
      const expressionContainer = node.parent;
      if (!isNodeOfType(expressionContainer, "JSXExpressionContainer")) return null;
      const attr = expressionContainer.parent;
      if (!isNodeOfType(attr, "JSXAttribute")) return null;
      const attrName = isNodeOfType(attr.name, "JSXIdentifier") ? attr.name.name : null;
      return attrName && RENDER_ITEM_PROP_NAMES.has(attrName) ? attrName : null;
    };

    const enter = (node: EsTreeNode): void => {
      const renderPropName = resolveRenderPropName(node);
      if (renderPropName) renderPropStack.push(renderPropName);
    };
    const exit = (node: EsTreeNode): void => {
      const renderPropName = resolveRenderPropName(node);
      if (renderPropName) renderPropStack.pop();
    };

    return {
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (renderPropStack.length === 0) return;
        if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
        const expression = node.value.expression;
        const isInlineObject = isNodeOfType(expression, "ObjectExpression");
        const isInlineArray = isNodeOfType(expression, "ArrayExpression");
        if (!isInlineObject && !isInlineArray) return;
        const literalKind = isInlineArray ? "array" : "object";
        context.report({
          node,
          message: `This ${literalKind} is rebuilt for every row, so your memo() rows still redraw.`,
        });
      },
    };
  },
});
