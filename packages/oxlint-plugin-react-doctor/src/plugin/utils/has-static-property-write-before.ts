import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isMemberWriteTarget = (memberExpression: EsTreeNode): boolean => {
  const parent = memberExpression.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "AssignmentExpression")) return parent.left === memberExpression;
  if (isNodeOfType(parent, "UpdateExpression")) return parent.argument === memberExpression;
  return (
    isNodeOfType(parent, "UnaryExpression") &&
    parent.operator === "delete" &&
    parent.argument === memberExpression
  );
};

const symbolHasStaticPropertyWriteBefore = (
  symbol: SymbolDescriptor,
  propertyName: string,
  referenceNode: EsTreeNode,
): boolean =>
  symbol.references.some((reference) => {
    if (reference.identifier.range[0] >= referenceNode.range[0]) return false;
    let receiver: EsTreeNode = reference.identifier;
    let parent = receiver.parent;
    while (parent && stripParenExpression(parent) === reference.identifier) {
      receiver = parent;
      parent = receiver.parent;
    }
    return Boolean(
      parent &&
      isNodeOfType(parent, "MemberExpression") &&
      stripParenExpression(parent.object) === reference.identifier &&
      getStaticPropertyName(parent) === propertyName &&
      isMemberWriteTarget(parent),
    );
  });

export const hasStaticPropertyWriteBefore = (
  identifier: EsTreeNode,
  propertyName: string,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const visitedSymbolIds = new Set<number>();
  let currentIdentifier = identifier;
  let symbol = scopes.symbolFor(currentIdentifier);
  while (symbol) {
    if (
      visitedSymbolIds.has(symbol.id) ||
      symbolHasStaticPropertyWriteBefore(symbol, propertyName, referenceNode)
    ) {
      return true;
    }
    visitedSymbolIds.add(symbol.id);
    if (symbol.kind !== "const" || !symbol.initializer) return false;
    const initializer = stripParenExpression(symbol.initializer);
    if (!isNodeOfType(initializer, "Identifier")) return false;
    currentIdentifier = initializer;
    symbol = scopes.symbolFor(currentIdentifier);
  }
  return false;
};
