import { analyze, type Scope, type ScopeManager } from "eslint-scope";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../../../utils/find-program-root.js";
import { VISITOR_KEYS } from "./constants.js";

export interface ProgramAnalysis {
  programNode: EsTreeNodeOfType<"Program">;
  scopeManager: ScopeManager;
}

// HACK: WeakMap keyed on the live Program node so all 8 effect rules
// share a single eslint-scope analysis per file. The analysis is built
// lazily on first access from any rule.
const programToAnalysis: WeakMap<EsTreeNode, ProgramAnalysis> = new WeakMap();

// Strips `.parent` from every node in the subtree and remembers the
// originals so we can restore them after eslint-scope's `analyze()`
// returns. eslint-scope walks the tree internally; if any node still
// has a `parent` reference back up, it falls into infinite recursion
// (verified — `RangeError: Maximum call stack size exceeded`).
const stripAndRecordParents = (
  root: EsTreeNode,
): Array<{ node: Record<string, unknown>; originalParent: unknown }> => {
  const restorations: Array<{ node: Record<string, unknown>; originalParent: unknown }> = [];
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (!("type" in record)) return;
    if ("parent" in record) {
      restorations.push({ node: record, originalParent: record.parent });
      record.parent = null;
    }
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      visit(record[key]);
    }
  };
  visit(root);
  return restorations;
};

const restoreParents = (
  restorations: ReadonlyArray<{ node: Record<string, unknown>; originalParent: unknown }>,
): void => {
  for (const restoration of restorations) {
    restoration.node.parent = restoration.originalParent;
  }
};

// Returns the program-level eslint-scope analysis, caching per program
// so repeated calls within the same file (across multiple rules) reuse
// the work. Safe to call from any rule visitor callback — the in-place
// parent-strip + restore happens synchronously within this function.
//
// Returns `null` only if we can't find a Program root via the live
// parent chain (shouldn't happen in practice — defensive).
export const getProgramAnalysis = (anyNode: EsTreeNode): ProgramAnalysis | null => {
  const programNode = findProgramRoot(anyNode);
  if (!programNode) return null;

  const cached = programToAnalysis.get(programNode);
  if (cached) return cached;

  const restorations = stripAndRecordParents(programNode);
  let scopeManager: ScopeManager;
  try {
    scopeManager = analyze(
      programNode as unknown as Parameters<typeof analyze>[0],
      {
        ecmaVersion: 2024,
        sourceType: "module",
        childVisitorKeys: VISITOR_KEYS,
        fallback: "iteration",
      } as Parameters<typeof analyze>[1],
    );
  } finally {
    restoreParents(restorations);
  }

  const analysis: ProgramAnalysis = { programNode, scopeManager };
  programToAnalysis.set(programNode, analysis);
  return analysis;
};

// Scope membership is fixed per file, so the linear scan over
// `manager.scopes` runs once per queried node — every rule and pass that
// asks about the same identifier afterwards gets a WeakMap hit.
const scopeByNodeCache = new WeakMap<ScopeManager, WeakMap<EsTreeNode, Scope | null>>();

// Replicates upstream's `context.sourceCode.getScope(node)`: returns the
// innermost scope that *contains* `node`. We find the deepest scope
// whose `block.range` strictly contains `node.range` (or whose `block`
// IS the node).
export const getScopeForNode = (node: EsTreeNode, manager: ScopeManager): Scope | null => {
  if (!node.range) return null;
  let scopeByNode = scopeByNodeCache.get(manager);
  if (!scopeByNode) {
    scopeByNode = new WeakMap();
    scopeByNodeCache.set(manager, scopeByNode);
  }
  if (scopeByNode.has(node)) return scopeByNode.get(node) ?? null;
  let bestScope: Scope | null = null;
  let bestSize = Infinity;
  for (const scope of manager.scopes) {
    const block = scope.block as unknown as EsTreeNode;
    if (!block?.range) continue;
    if (node.range[0] < block.range[0] || node.range[1] > block.range[1]) continue;
    const size = block.range[1] - block.range[0];
    // `<=` so that when two scopes have identical ranges (the
    // global + module pair always share the Program range), the
    // later-created (i.e. inner) scope wins — module-level
    // declarations live in the module scope, not the global one.
    if (size <= bestSize) {
      bestSize = size;
      bestScope = scope;
    }
  }
  scopeByNode.set(node, bestScope);
  return bestScope;
};
