import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const equivalentSymbolsByAnalysis = new WeakMap<ScopeAnalysis, Map<number, SymbolDescriptor[]>>();

const CONDITIONAL_EXECUTION_NODE_TYPES: ReadonlySet<string> = new Set([
  "CatchClause",
  "ConditionalExpression",
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "IfStatement",
  "LogicalExpression",
  "SwitchCase",
  "SwitchStatement",
  "TryStatement",
  "WhileStatement",
]);

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

const findExecutionBoundary = (node: EsTreeNode): EsTreeNode | null => {
  let current: EsTreeNode | null = node;
  while (current) {
    if (isFunctionLike(current) || isNodeOfType(current, "Program")) return current;
    current = current.parent ?? null;
  }
  return null;
};

const isOnUnconditionalPath = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  let current = node.parent ?? null;
  while (current && current !== boundary) {
    if (CONDITIONAL_EXECUTION_NODE_TYPES.has(current.type)) return false;
    current = current.parent ?? null;
  }
  return current === boundary;
};

const findFunctionBindingIdentifier = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration")) return functionNode.id ?? null;
  const parent = functionNode.parent;
  if (
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === functionNode &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return parent.id;
  }
  return null;
};

const findDirectCall = (identifier: EsTreeNode): EsTreeNode | null => {
  let callee: EsTreeNode = identifier;
  let parent = callee.parent;
  while (parent && stripParenExpression(parent) === identifier) {
    callee = parent;
    parent = callee.parent;
  }
  return parent && isNodeOfType(parent, "CallExpression") && parent.callee === callee
    ? parent
    : null;
};

export const isFunctionSynchronouslyInvokedBefore = (
  functionNode: EsTreeNode,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedFunctionNodes = new Set<EsTreeNode>(),
): boolean => {
  if (
    visitedFunctionNodes.has(functionNode) ||
    !isFunctionLike(functionNode) ||
    functionNode.generator
  ) {
    return false;
  }
  visitedFunctionNodes.add(functionNode);
  const referenceBoundary = findExecutionBoundary(referenceNode);
  if (!referenceBoundary) return false;
  const invocationCalls: EsTreeNode[] = [];
  const bindingIdentifier = findFunctionBindingIdentifier(functionNode);
  if (bindingIdentifier) {
    for (const symbol of getEquivalentSymbols(bindingIdentifier, scopes)) {
      for (const reference of symbol.references) {
        const call = findDirectCall(reference.identifier);
        if (call) invocationCalls.push(call);
      }
    }
  } else {
    const call = findDirectCall(functionNode);
    if (call) invocationCalls.push(call);
  }
  return invocationCalls.some((call) => {
    if (call.range[0] >= referenceNode.range[0]) return false;
    const callBoundary = findExecutionBoundary(call);
    if (!callBoundary) return false;
    if (callBoundary === referenceBoundary) return true;
    if (!isFunctionLike(callBoundary)) return false;
    return isFunctionSynchronouslyInvokedBefore(
      callBoundary,
      referenceNode,
      scopes,
      new Set(visitedFunctionNodes),
    );
  });
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
    let parent = reference.identifier.parent;
    while (parent && stripParenExpression(parent) === reference.identifier) {
      parent = parent.parent;
    }
    if (
      !parent ||
      !isNodeOfType(parent, "MemberExpression") ||
      stripParenExpression(parent.object) !== reference.identifier ||
      getResolvedStaticPropertyName(parent, scopes) !== propertyName ||
      !isMemberWriteTarget(parent)
    ) {
      return false;
    }
    const writeBoundary = findExecutionBoundary(parent);
    const referenceBoundary = findExecutionBoundary(referenceNode);
    if (!writeBoundary || !referenceBoundary || !isOnUnconditionalPath(parent, writeBoundary)) {
      return false;
    }
    if (writeBoundary === referenceBoundary) {
      return parent.range[0] < referenceNode.range[0];
    }
    return (
      isFunctionLike(writeBoundary) &&
      isFunctionSynchronouslyInvokedBefore(writeBoundary, referenceNode, scopes)
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
