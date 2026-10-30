import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getDefaultOrNamespaceImportKind = (
  symbol: SymbolDescriptor,
): "default" | "namespace" | null => {
  if (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")) return "default";
  if (isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) return "namespace";
  return getImportedName(symbol.declarationNode) === "default" ? "default" : null;
};
