import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getSymbolTypeAnnotation = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (!isNodeOfType(symbol.bindingIdentifier, "Identifier")) return null;
  const annotation = symbol.bindingIdentifier.typeAnnotation;
  if (!annotation || !isNodeOfType(annotation, "TSTypeAnnotation")) return null;
  return annotation.typeAnnotation;
};
