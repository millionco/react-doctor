import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { walkAst } from "../../../utils/walk-ast.js";

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
  visitor: (node: EsTreeNode) => void,
): void => {
  const visitedFunctions = new Set<EsTreeNode>();
  const visitFunction = (currentFunction: EsTreeNode): void => {
    if (visitedFunctions.has(currentFunction)) return;
    visitedFunctions.add(currentFunction);
    walkAst(currentFunction, (node) => {
      if (node !== currentFunction && isFunctionLike(node)) return false;
      visitor(node);
      if (!isNodeOfType(node, "CallExpression")) return;
      const calledFunction = resolveExactLocalFunction(node.callee, scopes);
      if (calledFunction) visitFunction(calledFunction);
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        !SYNCHRONOUS_CALLBACK_METHODS.has(getStaticPropertyName(node.callee) ?? "")
      ) {
        return;
      }
      for (const argument of node.arguments) {
        if (isNodeOfType(argument, "SpreadElement")) continue;
        const callback = resolveExactLocalFunction(argument, scopes);
        if (callback) visitFunction(callback);
      }
    });
  };
  visitFunction(functionNode);
};
