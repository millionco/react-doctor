import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findExportedValue } from "./find-exported-value.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const hasClosedDefaultFunctionExport = (
  component: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(component, "FunctionDeclaration") ||
    !component.id ||
    findExportedValue(program, "default") !== component
  )
    return false;
  const name = component.id.name;
  const outer = scopes.scopeFor(component).symbolsByName.get(name);
  const inner = scopes.ownScopeFor(component)?.symbolsByName.get(name);
  return Boolean(
    outer?.declarationNode === component &&
    inner?.declarationNode === component &&
    hasCompleteSymbolReferences(outer, program, scopes) &&
    hasCompleteSymbolReferences(inner, program, scopes) &&
    inner.references.length === 0 &&
    outer.references.every(
      ({ flag, identifier }) =>
        flag === "read" &&
        isNodeOfType(identifier.parent, "ExportDefaultDeclaration") &&
        identifier.parent.declaration === identifier,
    ),
  );
};
