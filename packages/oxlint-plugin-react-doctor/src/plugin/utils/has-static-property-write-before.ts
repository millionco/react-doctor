import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const equivalentSymbolsByAnalysis = new WeakMap<ScopeAnalysis, Map<number, SymbolDescriptor[]>>();
const potentiallyAliasedSymbolsByAnalysis = new WeakMap<
  ScopeAnalysis,
  Map<number, SymbolDescriptor[]>
>();

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

const getDirectAliasSourceSymbol = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const unwrappedExpression = stripParenExpression(expression);
  return isNodeOfType(unwrappedExpression, "Identifier")
    ? scopes.symbolFor(unwrappedExpression)
    : null;
};

const getDirectAssignmentSourceSymbol = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const assignmentTarget = findTransparentExpressionRoot(identifier);
  const parent = assignmentTarget.parent;
  if (
    !parent ||
    !isNodeOfType(parent, "AssignmentExpression") ||
    parent.operator !== "=" ||
    parent.left !== assignmentTarget
  ) {
    return null;
  }
  return getDirectAliasSourceSymbol(parent.right, scopes);
};

const isDirectAliasSourceReference = (identifier: EsTreeNode): boolean => {
  const aliasSource = findTransparentExpressionRoot(identifier);
  const parent = aliasSource.parent;
  if (
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === aliasSource &&
    (isNodeOfType(parent.id, "Identifier") || isNodeOfType(parent.id, "ObjectPattern"))
  ) {
    return true;
  }
  return Boolean(
    parent &&
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.operator === "=" &&
    parent.right === aliasSource &&
    isNodeOfType(stripParenExpression(parent.left), "Identifier"),
  );
};

const isDirectAliasOfKnownSymbol = (
  symbol: SymbolDescriptor,
  knownSymbolIds: ReadonlySet<number>,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    symbol.initializer &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    symbol.declarationNode.id === symbol.bindingIdentifier
  ) {
    const initializerSymbol = getDirectAliasSourceSymbol(symbol.initializer, scopes);
    if (initializerSymbol && knownSymbolIds.has(initializerSymbol.id)) return true;
  }
  return symbol.references.some((reference) => {
    const assignmentSourceSymbol = getDirectAssignmentSourceSymbol(reference.identifier, scopes);
    return Boolean(assignmentSourceSymbol && knownSymbolIds.has(assignmentSourceSymbol.id));
  });
};

const getPotentiallyAliasedSymbols = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor[] => {
  const rootSymbol = resolveConstIdentifierAlias(identifier, scopes);
  if (!rootSymbol) return [];
  let symbolsByRootId = potentiallyAliasedSymbolsByAnalysis.get(scopes);
  if (!symbolsByRootId) {
    symbolsByRootId = new Map();
    potentiallyAliasedSymbolsByAnalysis.set(scopes, symbolsByRootId);
  }
  const cachedSymbols = symbolsByRootId.get(rootSymbol.id);
  if (cachedSymbols) return cachedSymbols;
  const allSymbols: SymbolDescriptor[] = [];
  collectScopeSymbols(scopes.rootScope, allSymbols);
  const aliasedSymbolIds = new Set([rootSymbol.id]);
  let didAddAlias = true;
  while (didAddAlias) {
    didAddAlias = false;
    for (const symbol of allSymbols) {
      if (aliasedSymbolIds.has(symbol.id)) continue;
      if (!isDirectAliasOfKnownSymbol(symbol, aliasedSymbolIds, scopes)) continue;
      aliasedSymbolIds.add(symbol.id);
      didAddAlias = true;
    }
  }
  const aliasedSymbols = allSymbols.filter((symbol) => aliasedSymbolIds.has(symbol.id));
  symbolsByRootId.set(rootSymbol.id, aliasedSymbols);
  return aliasedSymbols;
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

const getMemberWriteTarget = (identifier: EsTreeNode): EsTreeNode | null => {
  let parent = identifier.parent;
  while (parent && stripParenExpression(parent) === identifier) {
    parent = parent.parent;
  }
  if (
    !parent ||
    !isNodeOfType(parent, "MemberExpression") ||
    stripParenExpression(parent.object) !== identifier ||
    !isMemberWriteTarget(parent)
  ) {
    return null;
  }
  return parent;
};

const getStaticPropertyWriteTarget = (
  identifier: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const writeTarget = getMemberWriteTarget(identifier);
  return writeTarget && getResolvedStaticPropertyName(writeTarget, scopes) === propertyName
    ? writeTarget
    : null;
};

const symbolHasStaticPropertyWriteBefore = (
  symbol: SymbolDescriptor,
  propertyName: string,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  symbol.references.some((reference) => {
    const writeTarget = getStaticPropertyWriteTarget(reference.identifier, propertyName, scopes);
    if (!writeTarget) return false;
    const writeBoundary = findExecutionBoundary(writeTarget);
    const referenceBoundary = findExecutionBoundary(referenceNode);
    if (
      !writeBoundary ||
      !referenceBoundary ||
      !isOnUnconditionalPath(writeTarget, writeBoundary)
    ) {
      return false;
    }
    if (writeBoundary === referenceBoundary) {
      return writeTarget.range[0] < referenceNode.range[0];
    }
    return (
      isFunctionLike(writeBoundary) &&
      isFunctionSynchronouslyInvokedBefore(writeBoundary, referenceNode, scopes)
    );
  });

const isStableStaticPropertyReference = (identifier: EsTreeNode): boolean => {
  if (isDirectAliasSourceReference(identifier)) return true;
  const identifierRoot = findTransparentExpressionRoot(identifier);
  const memberExpression = identifierRoot.parent;
  return Boolean(
    memberExpression &&
    isNodeOfType(memberExpression, "MemberExpression") &&
    stripParenExpression(memberExpression.object) === identifierRoot,
  );
};

export const hasPossibleStaticPropertyWrite = (
  identifier: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  return getPotentiallyAliasedSymbols(identifier, scopes).some((symbol) =>
    symbol.references.some((reference) => {
      const writeTarget = getMemberWriteTarget(reference.identifier);
      if (!writeTarget) return false;
      const writtenPropertyName = getResolvedStaticPropertyName(writeTarget, scopes);
      return writtenPropertyName === null || writtenPropertyName === propertyName;
    }),
  );
};

const canExecuteBefore = (
  candidateNode: EsTreeNode,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const candidateBoundary = findExecutionBoundary(candidateNode);
  const referenceBoundary = findExecutionBoundary(referenceNode);
  if (!candidateBoundary || !referenceBoundary) return true;
  if (candidateBoundary === referenceBoundary) {
    return candidateNode.range[0] < referenceNode.range[0];
  }
  if (!isFunctionLike(candidateBoundary)) return true;
  return isFunctionSynchronouslyInvokedBefore(candidateBoundary, referenceNode, scopes);
};

export const hasPossibleStaticPropertyWriteBefore = (
  identifier: EsTreeNode,
  propertyName: string,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  return getPotentiallyAliasedSymbols(identifier, scopes).some((symbol) =>
    symbol.references.some((reference) => {
      const writeTarget = getMemberWriteTarget(reference.identifier);
      if (!writeTarget || !canExecuteBefore(writeTarget, referenceNode, scopes)) return false;
      const writtenPropertyName = getResolvedStaticPropertyName(writeTarget, scopes);
      return writtenPropertyName === null || writtenPropertyName === propertyName;
    }),
  );
};

export const hasPossibleStaticPropertyMutationOrEscape = (
  identifier: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (hasPossibleStaticPropertyWrite(identifier, propertyName, scopes)) return true;
  return getPotentiallyAliasedSymbols(identifier, scopes).some((symbol) =>
    symbol.references.some((reference) => !isStableStaticPropertyReference(reference.identifier)),
  );
};

export const hasPossibleStaticMemberCallWrite = (
  callExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const unwrappedCallExpression = stripParenExpression(callExpression);
  if (!isNodeOfType(unwrappedCallExpression, "CallExpression")) return false;
  const callee = stripParenExpression(unwrappedCallExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(callee);
  if (propertyName === null) return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    hasPossibleStaticPropertyWrite(receiver, propertyName, scopes)
  );
};

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
