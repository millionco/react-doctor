import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import {
  CLOSED_JSON_SNAPSHOT_UNSUPPORTED_ATTRIBUTES,
  CLOSED_JSON_SNAPSHOT_TEXT_TAGS,
} from "./closed-json-snapshot-leaf/constants.js";

export const hasClosedJsonSnapshotNativeAttributes = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  indexSymbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    !CLOSED_JSON_SNAPSHOT_TEXT_TAGS.has(opening.name.name)
  )
    return false;
  return opening.attributes.every((attribute) => {
    if (!isNodeOfType(attribute, "JSXAttribute") || !isNodeOfType(attribute.name, "JSXIdentifier"))
      return false;
    if (CLOSED_JSON_SNAPSHOT_UNSUPPORTED_ATTRIBUTES.has(attribute.name.name)) return false;
    if (attribute.name.name === "key" && indexSymbol)
      return (
        isNodeOfType(attribute.value, "JSXExpressionContainer") &&
        isNodeOfType(stripParenExpression(attribute.value.expression), "Identifier") &&
        scopes.symbolFor(stripParenExpression(attribute.value.expression)) === indexSymbol
      );
    return true;
  });
};
