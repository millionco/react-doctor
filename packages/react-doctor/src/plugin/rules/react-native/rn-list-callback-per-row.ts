import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const LIST_ROW_PRESS_HANDLER_PROPS = new Set([
  "onPress",
  "onLongPress",
  "onPressIn",
  "onPressOut",
  "onSelect",
  "onClick",
]);

const detectInlineRowHandlers = (renderItemFn: EsTreeNode): EsTreeNode[] => {
  const inlineHandlers: EsTreeNode[] = [];
  walkAst(renderItemFn.body, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "JSXAttribute")) return;
    if (!isNodeOfType(child.name, "JSXIdentifier")) return;
    if (!LIST_ROW_PRESS_HANDLER_PROPS.has(child.name.name)) return;
    if (!isNodeOfType(child.value, "JSXExpressionContainer")) return;
    const expression = child.value.expression;
    if (
      isNodeOfType(expression, "ArrowFunctionExpression") ||
      isNodeOfType(expression, "FunctionExpression")
    ) {
      inlineHandlers.push(child);
    }
  });
  return inlineHandlers;
};

const isRenderItemJsxAttribute = (parent: EsTreeNode | null | undefined): boolean => {
  if (!isNodeOfType(parent, "JSXAttribute")) return false;
  const attrName = isNodeOfType(parent.name, "JSXIdentifier") ? parent.name.name : null;
  return attrName === "renderItem";
};

const isRenderItemFunction = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!isNodeOfType(parent, "JSXExpressionContainer")) return false;
  return isRenderItemJsxAttribute(parent.parent);
};

// HACK: every row of a virtualized list invokes its `renderItem`
// function — and any `() => onPress(item.id)` arrow created inside that
// function is a fresh closure per row, per render. memo()-wrapped row
// components see a different identity for the handler each time and
// rerender even when the row data didn't change. Hoist the handler at
// list scope (`const handlePress = useCallback((id) => ..., [])`) and
// pass the row's id as a primitive prop.
export const rnListCallbackPerRow = defineRule<Rule>({
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    "Hoist the handler with useCallback at list scope and pass the row id as a primitive prop, so the row's memo() shallow-compare actually hits",
  create: (context: RuleContext) => {
    const inspect = (node: EsTreeNode): void => {
      if (!isRenderItemFunction(node)) return;
      const inlineHandlers = detectInlineRowHandlers(node);
      for (const handler of inlineHandlers) {
        const handlerName = isNodeOfType(handler.name, "JSXIdentifier")
          ? handler.name.name
          : "<handler>";
        context.report({
          node: handler,
          message: `Inline ${handlerName} arrow inside renderItem creates a fresh closure per row — hoist with useCallback at list scope and pass the row id as a primitive prop`,
        });
      }
    };

    return {
      ArrowFunctionExpression: inspect,
      FunctionExpression: inspect,
    };
  },
});
