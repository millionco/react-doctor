import { LOOP_TYPES } from "../constants/js.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleVisitors } from "./rule-visitors.js";

// HACK: handlers accept narrower node types (e.g. `NewExpression`) than
// `EsTreeNode`. TS function-parameter contravariance rejects the wider
// signature, so use `never` here to satisfy variance while still letting
// the visitor type erase at the call site.
type LoopVisitor = (node: never) => void;

export const createLoopAwareVisitors = (
  innerVisitors: Record<string, LoopVisitor>,
): RuleVisitors => {
  let loopDepth = 0;
  const incrementLoopDepth = (): void => {
    loopDepth++;
  };
  const decrementLoopDepth = (): void => {
    loopDepth--;
  };

  const visitors: RuleVisitors = {};

  for (const loopType of LOOP_TYPES) {
    visitors[loopType] = incrementLoopDepth;
    visitors[`${loopType}:exit`] = decrementLoopDepth;
  }

  for (const [nodeType, handler] of Object.entries(innerVisitors)) {
    visitors[nodeType] = (node: EsTreeNode) => {
      if (loopDepth > 0) (handler as (input: EsTreeNode) => void)(node);
    };
  }

  return visitors;
};
