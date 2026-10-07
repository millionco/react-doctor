import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isStaticSpreadOnlyReference = (referenceNode: EsTreeNode): boolean => {
  const parent = referenceNode.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "JSXSpreadAttribute")) return parent.argument === referenceNode;
  if (isNodeOfType(parent, "SpreadElement")) return parent.argument === referenceNode;
  return isNodeOfType(parent, "VariableDeclarator") && parent.init === referenceNode;
};

const canExpressionOverrideJsxAttributeInternal = (
  expression: EsTreeNode,
  targetName: string,
  isCaseSensitive: boolean,
  scopes: ScopeAnalysis | undefined,
  visitedSymbolIds: Set<number>,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (scopes && isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some(
        (reference) =>
          reference.flag !== "read" || !isStaticSpreadOnlyReference(reference.identifier),
      )
    ) {
      return true;
    }
    visitedSymbolIds.add(symbol.id);
    const canOverride = canExpressionOverrideJsxAttributeInternal(
      symbol.initializer,
      targetName,
      isCaseSensitive,
      scopes,
      visitedSymbolIds,
    );
    visitedSymbolIds.delete(symbol.id);
    return canOverride;
  }
  if (!isNodeOfType(candidate, "ObjectExpression")) return true;
  const normalizedTargetName = isCaseSensitive ? targetName : targetName.toLowerCase();
  for (const property of candidate.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      if (
        canExpressionOverrideJsxAttributeInternal(
          property.argument,
          targetName,
          isCaseSensitive,
          scopes,
          visitedSymbolIds,
        )
      ) {
        return true;
      }
      continue;
    }
    if (!isNodeOfType(property, "Property")) return true;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName) return true;
    const normalizedPropertyName = isCaseSensitive ? propertyName : propertyName.toLowerCase();
    if (normalizedPropertyName === normalizedTargetName) return true;
  }
  return false;
};

export const canExpressionOverrideJsxAttribute = (
  expression: EsTreeNode,
  targetName: string,
  isCaseSensitive = true,
  scopes?: ScopeAnalysis,
): boolean =>
  canExpressionOverrideJsxAttributeInternal(
    expression,
    targetName,
    isCaseSensitive,
    scopes,
    new Set(),
  );
