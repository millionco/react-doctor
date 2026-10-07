import { defineRule } from "../../utils/define-rule.js";
import { areNodesInMutuallyExclusiveBranches } from "../../utils/are-nodes-in-mutually-exclusive-branches.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getReactRouterMiddlewareNextSymbol } from "../../utils/get-react-router-middleware-next-symbol.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

export const reactRouterNoMultipleMiddlewareNext = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-multiple-middleware-next",
    title: "Middleware continuation called twice",
    tags: ["test-noise"],
    requires: ["react-router:7.9", "react-router-framework"],
    severity: "error",
    recommendation: "Call next exactly once and reuse the returned Response.",
    create: (context: RuleContext) => {
      const inspectedFunctions = new WeakSet<EsTreeNode>();
      const inspectFunction = (functionNode: EsTreeNode): void => {
        if (!isFunctionLike(functionNode) || inspectedFunctions.has(functionNode)) return;
        inspectedFunctions.add(functionNode);
        const nextSymbol = getReactRouterMiddlewareNextSymbol(context, functionNode);
        if (nextSymbol === null) return;
        const nextCalls = nextSymbol.references.flatMap((reference) => {
          const callExpression = reference.identifier.parent;
          if (
            !isNodeOfType(callExpression, "CallExpression") ||
            callExpression.callee !== reference.identifier ||
            findEnclosingFunction(callExpression) !== functionNode
          ) {
            return [];
          }
          return [callExpression];
        });
        if (nextCalls.length < 2) return;
        const functionCfg = context.cfg.cfgFor(functionNode);
        if (functionCfg === null) return;
        const canReach = (sourceCall: EsTreeNode, targetCall: EsTreeNode): boolean => {
          const sourceBlock = functionCfg.blockOf(sourceCall);
          const targetBlock = functionCfg.blockOf(targetCall);
          if (sourceBlock === null || targetBlock === null) return false;
          const pendingBlocks = [sourceBlock];
          const visitedBlockIds = new Set<number>();
          while (pendingBlocks.length > 0) {
            const block = pendingBlocks.pop();
            if (block === undefined || visitedBlockIds.has(block.id)) continue;
            if (block === targetBlock) return true;
            visitedBlockIds.add(block.id);
            for (const edge of block.successors) pendingBlocks.push(edge.to);
          }
          return false;
        };
        let secondReachableCall: EsTreeNode | null = null;
        for (let firstIndex = 0; firstIndex < nextCalls.length; firstIndex += 1) {
          for (let secondIndex = firstIndex + 1; secondIndex < nextCalls.length; secondIndex += 1) {
            const firstCall = nextCalls[firstIndex];
            const secondCall = nextCalls[secondIndex];
            if (
              firstCall !== undefined &&
              secondCall !== undefined &&
              !areNodesInMutuallyExclusiveBranches(firstCall, secondCall) &&
              (canReach(firstCall, secondCall) || canReach(secondCall, firstCall))
            ) {
              secondReachableCall = secondCall;
              break;
            }
          }
          if (secondReachableCall !== null) break;
        }
        if (secondReachableCall === null) return;
        context.report({
          node: secondReachableCall,
          message: "Two next() calls can execute on the same middleware path.",
        });
      };
      return {
        ArrowFunctionExpression: inspectFunction,
        FunctionDeclaration: inspectFunction,
        FunctionExpression: inspectFunction,
      };
    },
  }),
);
