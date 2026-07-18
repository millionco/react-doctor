import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isNodeConditionallyExecuted } from "../../../utils/is-node-conditionally-executed.js";

const SYNCHRONOUS_CALLBACK_METHODS = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
  "sort",
]);

export const walkFunctionExecution = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitor: (node: EsTreeNode, isConditionallyExecuted: boolean) => void,
): void => {
  const conditionalityByVisitedFunction = new Map<EsTreeNode, boolean>();
  const visitFunction = (
    currentFunction: EsTreeNode,
    isConditionallyExecutedByCallSite: boolean,
  ): void => {
    if (!isFunctionLike(currentFunction) || currentFunction.generator) return;
    const previousConditionality = conditionalityByVisitedFunction.get(currentFunction);
    if (
      previousConditionality === false ||
      previousConditionality === isConditionallyExecutedByCallSite
    ) {
      return;
    }
    conditionalityByVisitedFunction.set(currentFunction, isConditionallyExecutedByCallSite);
    walkAst(currentFunction, (node) => {
      if (node !== currentFunction && isFunctionLike(node)) return false;
      const isConditionallyExecuted =
        isConditionallyExecutedByCallSite || isNodeConditionallyExecuted(node, currentFunction);
      visitor(node, isConditionallyExecuted);
      if (!isNodeOfType(node, "CallExpression")) return;
      const calledFunction = resolveExactLocalFunction(node.callee, scopes);
      if (calledFunction) visitFunction(calledFunction, isConditionallyExecuted);
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        !SYNCHRONOUS_CALLBACK_METHODS.has(getStaticPropertyName(node.callee) ?? "")
      ) {
        return;
      }
      for (const argument of node.arguments) {
        if (isNodeOfType(argument, "SpreadElement")) continue;
        const callback = resolveExactLocalFunction(argument, scopes);
        if (callback) visitFunction(callback, isConditionallyExecuted);
      }
    });
  };
  visitFunction(functionNode, false);
};
