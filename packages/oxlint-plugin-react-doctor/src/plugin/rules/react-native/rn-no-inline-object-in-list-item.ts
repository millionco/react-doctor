import { RENDER_ITEM_PROP_NAMES } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: inside `renderItem`, JSX prop values that are object literals
// (`style={{...}}`, `user={{...}}`, etc.) allocate a fresh object
// reference per row. Any `memo()`-wrapped row component bails its
// shallow-compare for that prop and rerenders even when the underlying
// data didn't change. Hoist the object outside renderItem (StyleSheet,
// constant, useMemo at list scope) or pass primitives into the row.
export const rnNoInlineObjectInListItem = defineRule({
  id: "rn-no-inline-object-in-list-item",
  title: "Inline object in list renderItem",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  // React Compiler auto-memoizes inline functions/objects in list rows, so the
  // perf footgun this rule guards against doesn't exist in compiler-enabled
  // projects (#723).
  disabledWhen: ["react-compiler"],
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

    const containsFreshObjectLiteral = (node: EsTreeNode | null): boolean => {
      if (!node) return false;
      if (isNodeOfType(node, "ObjectExpression")) return true;
      if (isNodeOfType(node, "ArrayExpression")) {
        return node.elements.some((element) => containsFreshObjectLiteral(element));
      }
      if (isNodeOfType(node, "LogicalExpression")) {
        return containsFreshObjectLiteral(node.left) || containsFreshObjectLiteral(node.right);
      }
      if (isNodeOfType(node, "ConditionalExpression")) {
        return (
          containsFreshObjectLiteral(node.consequent) || containsFreshObjectLiteral(node.alternate)
        );
      }
      if (isNodeOfType(node, "SpreadElement")) {
        return containsFreshObjectLiteral(node.argument);
      }
      return false;
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
        // HACK: a style ARRAY of StyleSheet refs (`[styles.row, styles.active]`)
        // allocates the outer array but no fresh per-row objects — RN dedupes
        // style refs, so memo() rows don't break on it. The exemption is
        // style-only: a fresh array on any other prop (`ids={[item.a]}`) is a
        // new identity per row, and a fresh object anywhere inside the style
        // tree (`[styles.row, item.active && { opacity: 0.5 }]`) still leaks.
        const attrName = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : null;
        const isStyleProp = Boolean(
          attrName && (attrName === "style" || attrName.endsWith("Style")),
        );
        if (isInlineArray && isStyleProp && !containsFreshObjectLiteral(expression)) {
          return;
        }
        const literalKind = isInlineArray ? "array" : "object";
        context.report({
          node,
          message: `This ${literalKind} is rebuilt for every row, so your memo() rows still redraw.`,
        });
      },
    };
  },
});
