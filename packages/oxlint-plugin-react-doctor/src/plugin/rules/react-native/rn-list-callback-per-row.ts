import { RENDER_ITEM_PROP_NAMES } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
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

const isRenderItemJsxAttribute = (parent: EsTreeNode | null | undefined): boolean => {
  if (!isNodeOfType(parent, "JSXAttribute")) return false;
  const attrName = isNodeOfType(parent.name, "JSXIdentifier") ? parent.name.name : null;
  return attrName ? RENDER_ITEM_PROP_NAMES.has(attrName) : false;
};

const detectInlineRowHandlers = (renderItemFn: EsTreeNode): EsTreeNode[] => {
  const inlineHandlers: EsTreeNode[] = [];
  if (
    !isNodeOfType(renderItemFn, "ArrowFunctionExpression") &&
    !isNodeOfType(renderItemFn, "FunctionExpression")
  ) {
    return inlineHandlers;
  }
  walkAst(renderItemFn.body, (child: EsTreeNode) => {
    // A nested list's direct-function `renderItem` is inspected as its own
    // renderItem function, so descending into it here would report its inline
    // handlers a second time. Prune only that shape — a wrapped renderItem
    // (useCallback, conditional) is never inspected on its own, so this walk
    // must descend into it.
    if (
      isNodeOfType(child, "JSXExpressionContainer") &&
      isRenderItemJsxAttribute(child.parent) &&
      (isNodeOfType(child.expression, "ArrowFunctionExpression") ||
        isNodeOfType(child.expression, "FunctionExpression"))
    ) {
      return false;
    }
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
export const rnListCallbackPerRow = defineRule({
  id: "rn-list-callback-per-row",
  title: "Inline handler in list renderItem",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  // React Compiler auto-memoizes inline functions/objects in list rows, so the
  // perf footgun this rule guards against doesn't exist in compiler-enabled
  // projects (#723).
  disabledWhen: ["react-compiler"],
  recommendation:
    "Move the handler out with useCallback at list scope and pass the row id as a prop. Then memo() rows skip redrawing when their data has not changed.",
  create: (context: RuleContext) => {
    const inspect = (node: EsTreeNode): void => {
      if (!isRenderItemFunction(node)) return;
      const inlineHandlers = detectInlineRowHandlers(node);
      for (const handler of inlineHandlers) {
        const handlerName =
          isNodeOfType(handler, "JSXAttribute") && isNodeOfType(handler.name, "JSXIdentifier")
            ? handler.name.name
            : "<handler>";
        context.report({
          node: handler,
          message: `This ${handlerName} is rebuilt for every row, so your memo() rows still redraw.`,
        });
      }
    };

    return {
      ArrowFunctionExpression: inspect,
      FunctionExpression: inspect,
    };
  },
});
