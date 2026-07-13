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
import { findProgramRoot } from "../../utils/find-program-root.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { resolveTanstackQueryHookNameFromInitializer } from "./utils/resolve-tanstack-query-hook-name.js";

const isTanstackQueryResult = (expression: EsTreeNode, context: RuleContext): boolean =>
  Boolean(resolveTanstackQueryHookNameFromInitializer(expression, context.scopes));

const isStaticRefetchMember = (memberExpression: EsTreeNodeOfType<"MemberExpression">): boolean =>
  (isNodeOfType(memberExpression.property, "Identifier") &&
    !memberExpression.computed &&
    memberExpression.property.name === "refetch") ||
  (isNodeOfType(memberExpression.property, "Literal") &&
    memberExpression.computed &&
    memberExpression.property.value === "refetch");

const refetchMemberWriteCache = new WeakMap<EsTreeNode, Map<number, boolean>>();

const hasRefetchMemberWrite = (expression: EsTreeNode, context: RuleContext): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return false;
  const resultSymbol = resolveConstIdentifierAlias(unwrappedExpression, context.scopes);
  if (!resultSymbol) return false;
  const program = findProgramRoot(expression);
  if (!program) return true;
  let writesBySymbolId = refetchMemberWriteCache.get(program);
  if (!writesBySymbolId) {
    writesBySymbolId = new Map();
    refetchMemberWriteCache.set(program, writesBySymbolId);
  }
  const cachedResult = writesBySymbolId.get(resultSymbol.id);
  if (cachedResult !== undefined) return cachedResult;
  let hasWrite = false;
  walkAst(program, (node) => {
    if (!isNodeOfType(node, "MemberExpression") || !isStaticRefetchMember(node)) return;
    const parent = node.parent;
    const isWrite =
      (isNodeOfType(parent, "AssignmentExpression") && parent.left === node) ||
      (isNodeOfType(parent, "UpdateExpression") && parent.argument === node) ||
      (isNodeOfType(parent, "UnaryExpression") && parent.operator === "delete");
    if (!isWrite) return;
    const object = stripParenExpression(node.object);
    if (!isNodeOfType(object, "Identifier")) return;
    const writtenSymbol = resolveConstIdentifierAlias(object, context.scopes);
    if (writtenSymbol?.id === resultSymbol.id) {
      hasWrite = true;
      return false;
    }
  });
  writesBySymbolId.set(resultSymbol.id, hasWrite);
  return hasWrite;
};

const isTanstackRefetchExpression = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    return (
      isStaticRefetchMember(unwrappedExpression) &&
      isTanstackQueryResult(unwrappedExpression.object, context) &&
      !hasRefetchMemberWrite(unwrappedExpression.object, context)
    );
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(unwrappedExpression);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read") ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  const bindingProperty = symbol.bindingIdentifier.parent;
  if (
    isNodeOfType(bindingProperty, "Property") &&
    getStaticPropertyKeyName(bindingProperty, { allowComputedString: true }) === "refetch"
  ) {
    const initializer = symbol.declarationNode.init;
    return Boolean(initializer && isTanstackQueryResult(initializer, context));
  }
  return Boolean(
    symbol.declarationNode.id === symbol.bindingIdentifier &&
    symbol.initializer &&
    isTanstackRefetchExpression(symbol.initializer, context, visitedSymbolIds),
  );
};

const isTanstackRefetchCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  return isTanstackRefetchExpression(callExpression.callee, context);
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
