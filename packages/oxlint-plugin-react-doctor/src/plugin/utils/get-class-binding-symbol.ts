import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getClassBindingSymbol = (
  classNode: EsTreeNodeOfType<"ClassDeclaration" | "ClassExpression">,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const parent = classNode.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return scopes.symbolFor(parent.id);
  }
  return isNodeOfType(classNode.id, "Identifier") ? scopes.symbolFor(classNode.id) : null;
};
