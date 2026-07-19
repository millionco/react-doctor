import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getClassBindingSymbol = (
  classNode: EsTreeNodeOfType<"ClassDeclaration" | "ClassExpression">,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (isNodeOfType(classNode.id, "Identifier")) return scopes.symbolFor(classNode.id);
  const parent = classNode.parent;
  return isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")
    ? scopes.symbolFor(parent.id)
    : null;
};
