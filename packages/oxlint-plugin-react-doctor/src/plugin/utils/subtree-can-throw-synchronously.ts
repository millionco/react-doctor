import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { SYNCHRONOUS_THROW_RESOLUTION_DEPTH } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const isInsideAbsorbingTry = (node: EsTreeNode, functionBoundary: EsTreeNode): boolean => {
  let child = node;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && ancestor !== functionBoundary) {
    if (isNodeOfType(ancestor, "TryStatement") && ancestor.block === child && ancestor.handler) {
      const catchHandler = ancestor.handler;
      let handlerRethrows = false;
      walkAst(catchHandler, (handlerChild: EsTreeNode) => {
        if (handlerRethrows) return false;
        if (handlerChild !== catchHandler && isFunctionLike(handlerChild)) return false;
        if (isNodeOfType(handlerChild, "ThrowStatement")) {
          handlerRethrows = true;
          return false;
        }
      });
      if (!handlerRethrows) return true;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

export const subtreeCanThrowSynchronously = (
  root: EsTreeNode,
  functionBoundary: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const visitedFunctions = new Set<EsTreeNode>();
  const analyze = (
    candidateRoot: EsTreeNode,
    candidateBoundary: EsTreeNode,
    remainingDepth: number,
  ): boolean => {
    let canThrow = false;
    walkAst(candidateRoot, (child: EsTreeNode) => {
      if (canThrow) return false;
      if (child !== candidateRoot && isFunctionLike(child)) return false;
      if (
        isNodeOfType(child, "ThrowStatement") &&
        !isInsideAbsorbingTry(child, candidateBoundary)
      ) {
        canThrow = true;
        return false;
      }
      if (
        remainingDepth <= 0 ||
        !isNodeOfType(child, "CallExpression") ||
        isInsideAbsorbingTry(child, candidateBoundary)
      ) {
        return;
      }
      const callee = stripParenExpression(child.callee);
      const calledFunction = isFunctionLike(callee)
        ? callee
        : isNodeOfType(callee, "Identifier")
          ? resolveExactLocalFunction(callee, scopes)
          : null;
      if (
        !calledFunction ||
        !isFunctionLike(calledFunction) ||
        calledFunction.async ||
        visitedFunctions.has(calledFunction)
      ) {
        return;
      }
      visitedFunctions.add(calledFunction);
      if (analyze(calledFunction, calledFunction, remainingDepth - 1)) {
        canThrow = true;
        return false;
      }
    });
    return canThrow;
  };
  return analyze(root, functionBoundary, SYNCHRONOUS_THROW_RESOLUTION_DEPTH);
};
