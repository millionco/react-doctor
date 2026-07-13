import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { collectEffectInvokedFunctions } from "../../utils/collect-effect-invoked-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { resolveTanstackQueryHookNameFromInitializer } from "./utils/resolve-tanstack-query-hook-name.js";

const isTanstackQueryResult = (expression: EsTreeNode, context: RuleContext): boolean =>
  Boolean(resolveTanstackQueryHookNameFromInitializer(expression, context.scopes));

const isTanstackRefetchIdentifier = (identifier: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "VariableDeclarator")) return false;
  const bindingProperty = symbol.bindingIdentifier.parent;
  if (!isNodeOfType(bindingProperty, "Property")) return false;
  if (getStaticPropertyKeyName(bindingProperty) !== "refetch") return false;
  const initializer = symbol.declarationNode.init;
  return Boolean(initializer && isTanstackQueryResult(initializer, context));
};

const isTanstackRefetchCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "Identifier")) {
    return isTanstackRefetchIdentifier(callee, context);
  }
  return (
    isNodeOfType(callee, "MemberExpression") &&
    ((isNodeOfType(callee.property, "Identifier") &&
      !callee.computed &&
      callee.property.name === "refetch") ||
      (isNodeOfType(callee.property, "Literal") &&
        callee.computed &&
        callee.property.value === "refetch")) &&
    isTanstackQueryResult(callee.object, context)
  );
};

export const queryNoQueryInEffect = defineRule({
  id: "query-no-query-in-effect",
  title: "Query refetch inside useEffect",
  tags: ["test-noise"],
  requires: ["tanstack-query"],
  severity: "warn",
  recommendation:
    "Use `queryKey` changes or `enabled` so React Query schedules the fetch once instead of refetching again from `useEffect`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      const effectInvokedFunctions = collectEffectInvokedFunctions(callback);
      walkAst(callback, (child: EsTreeNode) => {
        // Skip calls registered inside nested handlers (addEventListener /
        // setInterval) — those fire on an external event — but keep walking
        // into functions the effect body itself invokes (IIFEs, called local
        // functions, promise-chain callbacks): those run on every effect
        // execution.
        if (child !== callback && isFunctionLike(child) && !effectInvokedFunctions.has(child))
          return false;
        if (!isNodeOfType(child, "CallExpression")) return;

        if (isTanstackRefetchCall(child, context)) {
          context.report({
            node: child,
            message:
              "refetch() inside useEffect duplicates work React Query already does, causing extra fetches.",
          });
        }
      });
    },
  }),
});
