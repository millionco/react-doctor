import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const equivalentSymbolsByAnalysis = new WeakMap<ScopeAnalysis, Map<number, SymbolDescriptor[]>>();

const getResolvedStaticPropertyName = (
  memberExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  if (!isNodeOfType(memberExpression, "MemberExpression")) return null;
  const directPropertyName = getStaticPropertyName(memberExpression);
  if (directPropertyName || !memberExpression.computed) return directPropertyName;
  const property = stripParenExpression(memberExpression.property);
  if (!isNodeOfType(property, "Identifier")) return null;
  const propertySymbol = resolveConstIdentifierAlias(property, scopes);
  const initializer = propertySymbol?.initializer
    ? stripParenExpression(propertySymbol.initializer)
    : null;
  return initializer &&
    isNodeOfType(initializer, "Literal") &&
    typeof initializer.value === "string"
    ? initializer.value
    : null;
};

const collectScopeSymbols = (
  scope: ScopeAnalysis["rootScope"],
  symbols: SymbolDescriptor[],
): void => {
  symbols.push(...scope.symbols);
  for (const childScope of scope.children) collectScopeSymbols(childScope, symbols);
};

const getEquivalentSymbols = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor[] => {
  const rootSymbol = resolveConstIdentifierAlias(identifier, scopes);
  if (!rootSymbol) return [];
  let symbolsByRootId = equivalentSymbolsByAnalysis.get(scopes);
  if (!symbolsByRootId) {
    symbolsByRootId = new Map();
    equivalentSymbolsByAnalysis.set(scopes, symbolsByRootId);
  }
  const cachedSymbols = symbolsByRootId.get(rootSymbol.id);
  if (cachedSymbols) return cachedSymbols;
  const allSymbols: SymbolDescriptor[] = [];
  collectScopeSymbols(scopes.rootScope, allSymbols);
  const equivalentSymbols = allSymbols.filter(
    (symbol) => resolveConstIdentifierAlias(symbol.bindingIdentifier, scopes)?.id === rootSymbol.id,
  );
  symbolsByRootId.set(rootSymbol.id, equivalentSymbols);
  return equivalentSymbols;
};

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
  scopes: ScopeAnalysis,
): boolean =>
  symbol.references.some((reference) => {
    if (
      reference.scope === symbol.scope &&
      reference.identifier.range[0] >= referenceNode.range[0]
    ) {
      return false;
    }
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
      getResolvedStaticPropertyName(parent, scopes) === propertyName &&
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
  return getEquivalentSymbols(identifier, scopes).some((symbol) =>
    symbolHasStaticPropertyWriteBefore(symbol, propertyName, referenceNode, scopes),
  );
};
