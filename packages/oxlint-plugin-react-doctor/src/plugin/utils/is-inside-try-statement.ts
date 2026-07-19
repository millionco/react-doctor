import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

interface IsInsideTryStatementOptions {
  // "block" only counts the node as guarded when it sits in the `try {}` block
  // itself — a throw inside the `catch`/`finally` is NOT caught by that same
  // statement (the shape `no-unsafe-json-parse` needs). "any" counts any
  // enclosing `TryStatement` regardless of region (the looser shape the
  // color/decode/URL parse rule accepts). Defaults to "any".
  region?: "block" | "any";
  // Stop the ancestor walk when this node is reached (exclusive), so callers
  // can scope the search to a single function/effect body. Defaults to no
  // boundary (walk to the program root).
  boundary?: EsTreeNode | null;
  requireHandler?: boolean;
}

// Single source of truth for "is this node inside a try/catch". The three
// call sites deliberately disagreed on whether a `catch`/`finally` counts and
// whether the walk is bounded, so those choices are explicit options here
// rather than three near-identical helpers that silently diverge.
export const isInsideTryStatement = (
  node: EsTreeNode,
  options?: IsInsideTryStatementOptions,
): boolean => {
  const region = options?.region ?? "any";
  const boundary = options?.boundary ?? null;
  const requireHandler = options?.requireHandler ?? false;
  let child: EsTreeNode = node;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && ancestor !== boundary) {
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      (region === "any" || ancestor.block === child) &&
      (!requireHandler || ancestor.handler !== null)
    ) {
      return true;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};
