import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getSymbolReferenceIndex } from "./get-symbol-reference-index.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";

const bodyShadowedDefaultsByAnalysis = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, ReadonlySet<string>>
>();

export const hasReliableMatcherSymbolReferences = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!hasCompleteSymbolReferences(symbol, program, scopes)) return false;
  let byProgram = bodyShadowedDefaultsByAnalysis.get(scopes);
  if (!byProgram) {
    byProgram = new WeakMap();
    bodyShadowedDefaultsByAnalysis.set(scopes, byProgram);
  }
  let unsafeNames = byProgram.get(program);
  if (!unsafeNames) {
    const names = new Set<string>();
    const index = getSymbolReferenceIndex(program, scopes);
    for (const [candidate, identifiers] of index.resolvedNodes) {
      const owner = candidate.scope.node;
      if (
        !isNodeOfType(owner, "FunctionDeclaration") &&
        !isNodeOfType(owner, "FunctionExpression") &&
        !isNodeOfType(owner, "ArrowFunctionExpression")
      )
        continue;
      if (
        !isNodeOfType(owner.body, "BlockStatement") ||
        candidate.declarationNode.range[0] < owner.body.range[0]
      )
        continue;
      const bodyStart = owner.body.range[0];
      const ownerStart = owner.range[0];
      if (
        identifiers.some(
          (identifier) => identifier.range[0] >= ownerStart && identifier.range[0] < bodyStart,
        )
      )
        names.add(candidate.name);
    }
    unsafeNames = names;
    byProgram.set(program, names);
  }
  return !unsafeNames.has(symbol.name);
};
