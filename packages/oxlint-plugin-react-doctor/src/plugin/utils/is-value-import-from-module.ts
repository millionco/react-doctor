import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isValueImportFromModule = (
  symbol: SymbolDescriptor,
  moduleSource: string,
): boolean => {
  const declaration = getImportDeclarationForSymbol(symbol);
  return Boolean(
    declaration &&
    declaration.source.value === moduleSource &&
    declaration.importKind !== "type" &&
    (!isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
      symbol.declarationNode.importKind !== "type"),
  );
};
