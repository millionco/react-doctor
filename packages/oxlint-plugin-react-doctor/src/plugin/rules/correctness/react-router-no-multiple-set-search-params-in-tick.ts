import { defineRule } from "../../utils/define-rule.js";
import { areNodesInMutuallyExclusiveBranches } from "../../utils/are-nodes-in-mutually-exclusive-branches.js";
import { canNodeReachLaterNodeWithinFunction } from "../../utils/can-node-reach-later-node-within-function.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getImportedNameFromReactRouter } from "../../utils/get-imported-name-from-react-router.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const hasDirectAwaitBetween = (
  firstCall: EsTreeNode,
  secondCall: EsTreeNode,
  functionNode: EsTreeNode,
): boolean => {
  const firstCallStart = getRangeStart(firstCall);
  const secondCallStart = getRangeStart(secondCall);
  if (firstCallStart === null || secondCallStart === null) return true;
  let foundAwait = false;
  walkAst(functionNode, (node: EsTreeNode) => {
    if (foundAwait) return false;
    if (node !== functionNode && isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "AwaitExpression")) return;
    const awaitStart = getRangeStart(node);
    if (awaitStart !== null && awaitStart > firstCallStart && awaitStart < secondCallStart) {
      foundAwait = true;
      return false;
    }
  });
  return foundAwait;
};

const canExecuteAfter = (
  firstCall: EsTreeNode,
  secondCall: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const functionNode = context.cfg.enclosingFunction(firstCall);
  if (functionNode === null || context.cfg.enclosingFunction(secondCall) !== functionNode) {
    return null;
  }
  return canNodeReachLaterNodeWithinFunction(firstCall, secondCall, functionNode, context)
    ? functionNode
    : null;
};

export const reactRouterNoMultipleSetSearchParamsInTick = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-multiple-set-search-params-in-tick",
    title: "Search params updated multiple times",
    tags: ["test-noise"],
    requires: ["react-router"],
    severity: "warn",
    recommendation:
      "Combine changes into one setSearchParams call because updates in the same tick do not queue like React state.",
    create: (context: RuleContext) => ({
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "ArrayPattern")) return;
        if (!isNodeOfType(node.init, "CallExpression")) return;
        if (!isNodeOfType(node.init.callee, "Identifier")) return;
        if (
          getImportedNameFromReactRouter(context, node.init.callee, node.init.callee.name) !==
          "useSearchParams"
        ) {
          return;
        }
        const setterBinding = node.id.elements?.[1];
        if (!isNodeOfType(setterBinding, "Identifier")) return;
        const setterSymbol = context.scopes.symbolFor(setterBinding);
        if (setterSymbol === null) return;

        const setterCalls = setterSymbol.references
          .flatMap((reference) => {
            const callExpression = reference.identifier.parent;
            return isNodeOfType(callExpression, "CallExpression") &&
              callExpression.callee === reference.identifier
              ? [callExpression]
              : [];
          })
          .sort((firstCall, secondCall) => {
            const firstStart = getRangeStart(firstCall) ?? 0;
            const secondStart = getRangeStart(secondCall) ?? 0;
            return firstStart - secondStart;
          });
        for (let callIndex = 1; callIndex < setterCalls.length; callIndex += 1) {
          const callExpression = setterCalls[callIndex];
          if (callExpression === undefined) continue;
          const hasEarlierSynchronousCall = setterCalls.slice(0, callIndex).some((previousCall) => {
            if (areNodesInMutuallyExclusiveBranches(previousCall, callExpression)) return false;
            const functionNode = canExecuteAfter(previousCall, callExpression, context);
            return (
              functionNode !== null &&
              !hasDirectAwaitBetween(previousCall, callExpression, functionNode)
            );
          });
          if (!hasEarlierSynchronousCall) continue;
          context.report({
            node: callExpression,
            message: `${setterBinding.name}() is called more than once on the same synchronous path, so an earlier update can be discarded.`,
          });
        }
      },
    }),
  }),
);
