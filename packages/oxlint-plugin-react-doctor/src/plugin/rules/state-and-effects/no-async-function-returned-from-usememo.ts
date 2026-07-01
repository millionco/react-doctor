import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const getMemoReturnedExpression = (memoCallback: EsTreeNode): EsTreeNode | null => {
  if (
    !isNodeOfType(memoCallback, "ArrowFunctionExpression") &&
    !isNodeOfType(memoCallback, "FunctionExpression")
  ) {
    return null;
  }
  if (!isNodeOfType(memoCallback.body, "BlockStatement")) {
    return stripParenExpression(memoCallback.body);
  }
  const statements = memoCallback.body.body ?? [];
  for (const statement of statements) {
    if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
      return stripParenExpression(statement.argument);
    }
  }
  return null;
};

const isAsyncFunctionExpression = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "ArrowFunctionExpression") || isNodeOfType(node, "FunctionExpression")) &&
  Boolean(node.async);

export const noAsyncFunctionReturnedFromUsememo = defineRule({
  id: "no-async-function-returned-from-usememo",
  title: "useMemo returns an async function",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "Wrapping a function in useMemo recreates it on every deps change instead of stabilizing it, so switch to useCallback (`const fn = useCallback(async () => {...}, deps)`) which is the hook meant to memoize a function's identity.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, "useMemo")) return;
      const memoCallback = node.arguments?.[0];
      if (!memoCallback) return;
      const returnedExpression = getMemoReturnedExpression(memoCallback);
      if (!returnedExpression) return;
      if (!isAsyncFunctionExpression(returnedExpression)) return;
      context.report({
        node,
        message:
          "Your useMemo returns an async function, so it rebuilds a new function reference on every deps change and defeats the memoization you wanted; use useCallback instead.",
      });
    },
  }),
});
