import { LOOP_TYPES } from "../constants/js.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleVisitors } from "./rule-visitors.js";

// HACK: handlers accept narrower node types (e.g. `NewExpression`) than
// `EsTreeNode`. TS function-parameter contravariance rejects the wider
// signature, so use `never` here to satisfy variance while still letting
// the visitor type erase at the call site.
type LoopVisitor = (node: never) => void;

interface LoopAwareVisitorOptions {
  // Also treat array-iteration callbacks (`items.map(fn)`, `.forEach`,
  // …) as loop bodies: the callback runs once per element, so work
  // inside it is per-pass work just like a `for` body.
  treatIteratorCallbacksAsLoops?: boolean;
}

const ITERATOR_CALLBACK_METHOD_NAMES: ReadonlySet<string> = new Set([
  "map",
  "flatMap",
  "forEach",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "reduce",
  "reduceRight",
]);

const FUNCTION_EXPRESSION_TYPES = ["ArrowFunctionExpression", "FunctionExpression"];

const isIteratorCallback = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if (!parent.arguments.includes(node as never)) return false;
  return (
    isNodeOfType(parent.callee, "MemberExpression") &&
    isNodeOfType(parent.callee.property, "Identifier") &&
    ITERATOR_CALLBACK_METHOD_NAMES.has(parent.callee.property.name)
  );
};

export const createLoopAwareVisitors = (
  innerVisitors: Record<string, LoopVisitor>,
  options: LoopAwareVisitorOptions = {},
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

  if (options.treatIteratorCallbacksAsLoops) {
    for (const functionType of FUNCTION_EXPRESSION_TYPES) {
      visitors[functionType] = (node: EsTreeNode) => {
        if (isIteratorCallback(node)) loopDepth++;
      };
      visitors[`${functionType}:exit`] = (node: EsTreeNode) => {
        if (isIteratorCallback(node)) loopDepth--;
      };
    }
  }

  for (const [nodeType, handler] of Object.entries(innerVisitors)) {
    visitors[nodeType] = (node: EsTreeNode) => {
      if (loopDepth > 0) (handler as (input: EsTreeNode) => void)(node);
    };
  }

  return visitors;
};
