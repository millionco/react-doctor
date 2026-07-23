import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { SYNCHRONOUS_THROW_RESOLUTION_DEPTH } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const catchHandlerRethrows = (catchHandler: EsTreeNode): boolean => {
  let foundThrow = false;
  walkAst(catchHandler, (handlerChild: EsTreeNode) => {
    if (foundThrow) return false;
    if (handlerChild !== catchHandler && isFunctionLike(handlerChild)) return false;
    if (isNodeOfType(handlerChild, "ThrowStatement")) {
      foundThrow = true;
      return false;
    }
  });
  return foundThrow;
};

const isInsideAbsorbingTry = (
  node: EsTreeNode,
  functionBoundary: EsTreeNode,
  memo: Map<string, boolean>,
  rethrowMemo: Map<EsTreeNode, boolean>,
): boolean => {
  const nodeStart = (node as { start?: unknown }).start;
  const boundaryStart = (functionBoundary as { start?: unknown }).start;
  const memoKey =
    typeof nodeStart === "number" && typeof boundaryStart === "number"
      ? `${nodeStart}:${boundaryStart}`
      : null;
  if (memoKey !== null) {
    const cached = memo.get(memoKey);
    if (cached !== undefined) return cached;
  }
  const result = isInsideAbsorbingTryUncached(node, functionBoundary, rethrowMemo);
  if (memoKey !== null) {
    memo.set(memoKey, result);
  }
  return result;
};

const isInsideAbsorbingTryUncached = (
  node: EsTreeNode,
  functionBoundary: EsTreeNode,
  rethrowMemo: Map<EsTreeNode, boolean>,
): boolean => {
  let child = node;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && ancestor !== functionBoundary) {
    if (isNodeOfType(ancestor, "TryStatement") && ancestor.block === child && ancestor.handler) {
      let handlerRethrows = rethrowMemo.get(ancestor.handler);
      if (handlerRethrows === undefined) {
        handlerRethrows = catchHandlerRethrows(ancestor.handler);
        rethrowMemo.set(ancestor.handler, handlerRethrows);
      }
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
  const tryAbsorptionMemo = new Map<string, boolean>();
  const rethrowMemo = new Map<EsTreeNode, boolean>();
  const analyzeMemo = new Map<string, boolean>();
  const analyze = (
    candidateRoot: EsTreeNode,
    candidateBoundary: EsTreeNode,
    remainingDepth: number,
  ): boolean => {
    const rootStart = (candidateRoot as { start?: unknown }).start;
    const boundaryStart = (candidateBoundary as { start?: unknown }).start;
    if (typeof rootStart === "number" && typeof boundaryStart === "number") {
      const memoKey = `${rootStart}:${boundaryStart}:${remainingDepth}`;
      const cached = analyzeMemo.get(memoKey);
      if (cached !== undefined) return cached;
    }
    let canThrow = false;
    walkAst(candidateRoot, (child: EsTreeNode) => {
      if (canThrow) return false;
      if (child !== candidateRoot && isFunctionLike(child)) return false;
      if (
        isNodeOfType(child, "ThrowStatement") &&
        !isInsideAbsorbingTry(child, candidateBoundary, tryAbsorptionMemo, rethrowMemo)
      ) {
        canThrow = true;
        return false;
      }
      if (
        remainingDepth <= 0 ||
        !isNodeOfType(child, "CallExpression") ||
        isInsideAbsorbingTry(child, candidateBoundary, tryAbsorptionMemo, rethrowMemo)
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
    if (typeof rootStart === "number" && typeof boundaryStart === "number") {
      const memoKey = `${rootStart}:${boundaryStart}:${remainingDepth}`;
      analyzeMemo.set(memoKey, canThrow);
    }
    return canThrow;
  };
  return analyze(root, functionBoundary, SYNCHRONOUS_THROW_RESOLUTION_DEPTH);
};
