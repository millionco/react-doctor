import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const RENDER_ITEM_PROP_NAMES = new Set([
  "renderItem",
  "renderSectionHeader",
  "renderSectionFooter",
]);

// HACK: inside `renderItem`, JSX prop values that are object literals
// (`style={{...}}`, `user={{...}}`, etc.) allocate a fresh object
// reference per row. Any `memo()`-wrapped row component bails its
// shallow-compare for that prop and rerenders even when the underlying
// data didn't change. Hoist the object outside renderItem (StyleSheet,
// constant, useMemo at list scope) or pass primitives into the row.
export const rnNoInlineObjectInListItem = defineRule<Rule>({
  id: "rn-no-inline-object-in-list-item",
  requires: ["react-native"],
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    "Hoist style/object props outside renderItem (StyleSheet.create, useMemo at list scope, or pass primitives) so memo() row components stop bailing",
  examples: [
    {
      before: "renderItem={({ item }) => <Row item={item} style={{ padding: 8 }} />}",
      after:
        "const ROW_STYLE = { padding: 8 };\nrenderItem={({ item }) => <Row item={item} style={ROW_STYLE} />}",
    },
  ],
  create: (context: RuleContext) => {
    let renderItemDepth = 0;

    const isRenderItemAttribute = (parent: EsTreeNode | null | undefined): boolean => {
      if (!isNodeOfType(parent, "JSXAttribute")) return false;
      const attrName = isNodeOfType(parent.name, "JSXIdentifier") ? parent.name.name : null;
      return attrName ? RENDER_ITEM_PROP_NAMES.has(attrName) : false;
    };

    const isRenderItemFunction = (node: EsTreeNode): boolean => {
      if (
        !isNodeOfType(node, "ArrowFunctionExpression") &&
        !isNodeOfType(node, "FunctionExpression")
      ) {
        return false;
      }
      // Walk up: parent should be JSXExpressionContainer whose parent is JSXAttribute renderItem.
      const expressionContainer = node.parent;
      if (!isNodeOfType(expressionContainer, "JSXExpressionContainer")) return false;
      return isRenderItemAttribute(expressionContainer.parent);
    };

    const enter = (node: EsTreeNode): void => {
      if (isRenderItemFunction(node)) renderItemDepth++;
    };
    const exit = (node: EsTreeNode): void => {
      if (isRenderItemFunction(node)) renderItemDepth = Math.max(0, renderItemDepth - 1);
    };

    return {
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (renderItemDepth === 0) return;
        if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
        if (!isNodeOfType(node.value.expression, "ObjectExpression")) return;
        const propName = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : "<unknown>";
        context.report({
          node,
          message: `Inline object literal on "${propName}" inside renderItem — allocates a fresh reference per row and breaks memo() on the row component. Hoist outside renderItem or pass primitives`,
        });
      },
    };
  },
});
