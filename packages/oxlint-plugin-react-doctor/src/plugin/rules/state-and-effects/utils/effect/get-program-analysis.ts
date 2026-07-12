import { analyze, type Reference, type Scope, type ScopeManager } from "eslint-scope";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../../../utils/find-program-root.js";
import { RUNTIME_VISITOR_KEYS } from "../../../../utils/runtime-visitor-keys.js";
import { getAstChildKeys } from "./get-ast-child-keys.js";

export interface ProgramAnalysis {
  programNode: EsTreeNodeOfType<"Program">;
  scopeManager: ScopeManager;
  scopeByNode: WeakMap<EsTreeNode, Scope | null>;
  referenceByIdentifier: WeakMap<EsTreeNode, Reference | null>;
}

// HACK: WeakMap keyed on the live Program node so all 8 effect rules
// share a single eslint-scope analysis per file. The analysis is built
// lazily on first access from any rule.
const programToAnalysis: WeakMap<EsTreeNode, ProgramAnalysis> = new WeakMap();

// Returns the program-level eslint-scope analysis, caching per program
// so repeated calls within the same file (across multiple rules) reuse
// the work. ESLint's keys skip type-only children on runtime node shapes,
// while the Oxc-backed fallback covers TypeScript-only node types
// without enumerating the `parent` property.
//
// Returns `null` only if we can't find a Program root via the live
// parent chain (shouldn't happen in practice — defensive).
export const getProgramAnalysis = (anyNode: EsTreeNode): ProgramAnalysis | null => {
  const programNode = findProgramRoot(anyNode);
  if (!programNode) return null;

  const cached = programToAnalysis.get(programNode);
  if (cached) return cached;

  const scopeManager: ScopeManager = analyze(
    programNode as unknown as Parameters<typeof analyze>[0],
    {
      ecmaVersion: 2024,
      sourceType: "module",
      childVisitorKeys: RUNTIME_VISITOR_KEYS,
      fallback: getAstChildKeys,
    } as Parameters<typeof analyze>[1],
  );

  const analysis: ProgramAnalysis = {
    programNode,
    scopeManager,
    scopeByNode: new WeakMap(),
    referenceByIdentifier: new WeakMap(),
  };
  programToAnalysis.set(programNode, analysis);
  return analysis;
};

// Scope membership is fixed per file, so the linear scan over
// `manager.scopes` runs once per queried node — every rule and pass that
// asks about the same identifier afterwards gets a WeakMap hit.
// Replicates upstream's `context.sourceCode.getScope(node)`: returns the
// innermost scope that *contains* `node`. We find the deepest scope
// whose `block.range` strictly contains `node.range` (or whose `block`
// IS the node).
export const getScopeForNode = (node: EsTreeNode, analysis: ProgramAnalysis): Scope | null => {
  if (!node.range) return null;
  const scopeByNode = analysis.scopeByNode;
  if (scopeByNode.has(node)) return scopeByNode.get(node) ?? null;
  let bestScope: Scope | null = null;
  let bestSize = Infinity;
  for (const scope of analysis.scopeManager.scopes) {
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
