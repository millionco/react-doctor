import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import type { RuleVisitors } from "./rule-visitors.js";

// HACK: handlers accept narrower node types (e.g. `NewExpression`) than
// `EsTreeNode`. TS function-parameter contravariance rejects the wider
// signature, so use `never` here to satisfy variance while still letting
// the visitor type erase at the call site.
type LoopVisitor = (node: never) => void;

// Forwards each inner visitor only when the visited node executes once
// per iteration of an enclosing loop in ITS OWN function. Uses the CFG's
// `isInsideLoop` (cycle membership) rather than a lexical loop-nesting
// counter, so a node inside a callback that merely escapes a loop
// (`for (...) { el.onclick = () => new RegExp(x); }`) is correctly NOT
// treated as in-loop — the callback is a separate function with its own
// acyclic CFG.
export const createLoopAwareVisitors = (
  context: RuleContext,
  innerVisitors: Record<string, LoopVisitor>,
): RuleVisitors => {
  const visitors: RuleVisitors = {};

  for (const [nodeType, handler] of Object.entries(innerVisitors)) {
    visitors[nodeType] = (node: EsTreeNode) => {
      if (context.cfg.isInsideLoop(node)) (handler as (input: EsTreeNode) => void)(node);
    };
  }

  return visitors;
};
