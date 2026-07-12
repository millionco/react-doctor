import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getSymbolTypeAnnotation = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (!isNodeOfType(symbol.bindingIdentifier, "Identifier")) return null;
  const annotation = symbol.bindingIdentifier.typeAnnotation;
  if (annotation && isNodeOfType(annotation, "TSTypeAnnotation")) return annotation.typeAnnotation;

  const bindingProperty = symbol.bindingIdentifier.parent;
  const bindingPattern = bindingProperty?.parent;
  if (
    !isNodeOfType(bindingProperty, "Property") ||
    !isNodeOfType(bindingPattern, "ObjectPattern")
  ) {
    return null;
  }
  const patternAnnotation = bindingPattern.typeAnnotation;
  if (!patternAnnotation || !isNodeOfType(patternAnnotation, "TSTypeAnnotation")) return null;
  const objectType = patternAnnotation.typeAnnotation;
  if (!isNodeOfType(objectType, "TSTypeLiteral")) return null;
  const propertyName = isNodeOfType(bindingProperty.key, "Identifier")
    ? bindingProperty.key.name
    : isNodeOfType(bindingProperty.key, "Literal") && typeof bindingProperty.key.value === "string"
      ? bindingProperty.key.value
      : null;
  if (!propertyName) return null;
  for (const typeMember of objectType.members) {
    if (!isNodeOfType(typeMember, "TSPropertySignature")) continue;
    const memberName = isNodeOfType(typeMember.key, "Identifier")
      ? typeMember.key.name
      : isNodeOfType(typeMember.key, "Literal") && typeof typeMember.key.value === "string"
        ? typeMember.key.value
        : null;
    if (memberName !== propertyName) continue;
    return typeMember.typeAnnotation?.typeAnnotation ?? null;
  }
  return null;
};
