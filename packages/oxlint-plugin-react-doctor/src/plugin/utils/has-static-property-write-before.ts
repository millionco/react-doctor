import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getExecutionReferenceOffset } from "./get-execution-reference-offset.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

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

export const isNodeOnUnconditionalPath = (node: EsTreeNode, boundary: EsTreeNode): boolean => {
  let current = node.parent ?? null;
  while (current && current !== boundary) {
    if (CONDITIONAL_EXECUTION_NODE_TYPES.has(current.type)) return false;
    current = current.parent ?? null;
  }
  return current === boundary;
};

const exactLocalFunctionCallsByAnalysis = new WeakMap<
  ScopeAnalysis,
  Map<EsTreeNode, EsTreeNode[]>
>();

const getExactLocalFunctionCalls = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode[] => {
  let callsByFunction = exactLocalFunctionCallsByAnalysis.get(scopes);
  if (!callsByFunction) {
    const discoveredCallsByFunction = new Map<EsTreeNode, EsTreeNode[]>();
    const resolvedFunctionsBySymbolId = new Map<number, EsTreeNode | null>();
    const program = findProgramRoot(functionNode);
    if (program) {
      walkAst(program, (candidate) => {
        if (!isNodeOfType(candidate, "CallExpression")) return;
        const callee = stripParenExpression(candidate.callee);
        const calleeSymbol = isNodeOfType(callee, "Identifier") ? scopes.symbolFor(callee) : null;
        let calledFunction = calleeSymbol
          ? resolvedFunctionsBySymbolId.get(calleeSymbol.id)
          : undefined;
        if (calledFunction === undefined) {
          calledFunction = resolveExactLocalFunction(candidate.callee, scopes);
          if (calleeSymbol) resolvedFunctionsBySymbolId.set(calleeSymbol.id, calledFunction);
        }
        if (!calledFunction) return;
        const calls = discoveredCallsByFunction.get(calledFunction) ?? [];
        calls.push(candidate);
        discoveredCallsByFunction.set(calledFunction, calls);
      });
    }
    callsByFunction = discoveredCallsByFunction;
    exactLocalFunctionCallsByAnalysis.set(scopes, callsByFunction);
  }
  return callsByFunction.get(functionNode) ?? [];
};

const firstAwaitOffsetByFunction = new WeakMap<EsTreeNode, number | null>();

const isBeforeFirstAwait = (node: EsTreeNode, functionNode: EsTreeNode): boolean => {
  let firstAwaitOffset = firstAwaitOffsetByFunction.get(functionNode);
  if (firstAwaitOffset === undefined) {
    let discoveredFirstAwaitOffset: number | null = null;
    walkAst(functionNode, (candidate) => {
      if (
        isNodeOfType(candidate, "AwaitExpression") &&
        findEnclosingFunction(candidate) === functionNode &&
        (discoveredFirstAwaitOffset === null || candidate.range[0] < discoveredFirstAwaitOffset)
      ) {
        discoveredFirstAwaitOffset = candidate.range[0];
      }
    });
    firstAwaitOffset = discoveredFirstAwaitOffset;
    firstAwaitOffsetByFunction.set(functionNode, firstAwaitOffset);
  }
  return firstAwaitOffset === null || node.range[0] < firstAwaitOffset;
};

export const getFunctionSynchronousInvocationPathsBefore = (
  functionNode: EsTreeNode,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedFunctionNodes = new Set<EsTreeNode>(),
  synchronousNode: EsTreeNode | null = null,
  isSynchronousNode?: (node: EsTreeNode) => boolean,
): number[][] => {
  if (
    visitedFunctionNodes.has(functionNode) ||
    !isFunctionLike(functionNode) ||
    functionNode.generator ||
    (synchronousNode !== null && !isNodeOnUnconditionalPath(synchronousNode, functionNode)) ||
    (synchronousNode !== null &&
      isSynchronousNode !== undefined &&
      !isSynchronousNode(synchronousNode)) ||
    (synchronousNode !== null &&
      functionNode.async &&
      !isBeforeFirstAwait(synchronousNode, functionNode))
  ) {
    return [];
  }
  visitedFunctionNodes.add(functionNode);
  const referenceBoundary = findExecutionBoundary(referenceNode);
  if (!referenceBoundary) return [];
  const invocationCalls = getExactLocalFunctionCalls(functionNode, scopes);
  return invocationCalls.flatMap((call) => {
    const callBoundary = findExecutionBoundary(call);
    if (!callBoundary) return [];
    if (synchronousNode !== null && !isNodeOnUnconditionalPath(call, callBoundary)) return [];
    if (synchronousNode !== null && isSynchronousNode !== undefined && !isSynchronousNode(call)) {
      return [];
    }
    if (callBoundary === referenceBoundary) {
      return call.range[0] < getExecutionReferenceOffset(referenceNode) ? [[call.range[0]]] : [];
    }
    if (!isFunctionLike(callBoundary)) return [];
    return getFunctionSynchronousInvocationPathsBefore(
      callBoundary,
      referenceNode,
      scopes,
      new Set(visitedFunctionNodes),
      synchronousNode === null ? null : call,
      isSynchronousNode,
    ).map((invocationPath) => [...invocationPath, call.range[0]]);
  });
};

export const isFunctionSynchronouslyInvokedBefore = (
  functionNode: EsTreeNode,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedFunctionNodes = new Set<EsTreeNode>(),
  synchronousNode: EsTreeNode | null = null,
): boolean =>
  getFunctionSynchronousInvocationPathsBefore(
    functionNode,
    referenceNode,
    scopes,
    visitedFunctionNodes,
    synchronousNode,
  ).length > 0;

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
      !isNodeOnUnconditionalPath(writeTarget, writeBoundary)
    ) {
      return false;
    }
    if (writeBoundary === referenceBoundary) {
      return writeTarget.range[0] < getExecutionReferenceOffset(referenceNode);
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

const isNonMutatingStaticPropertyReference = (identifier: EsTreeNode): boolean => {
  if (isDirectAliasSourceReference(identifier)) return true;
  const identifierRoot = findTransparentExpressionRoot(identifier);
  const memberExpression = identifierRoot.parent;
  if (
    !memberExpression ||
    !isNodeOfType(memberExpression, "MemberExpression") ||
    stripParenExpression(memberExpression.object) !== identifierRoot
  ) {
    return false;
  }
  const memberRoot = findTransparentExpressionRoot(memberExpression);
  const memberParent = memberRoot.parent;
  return !(
    memberParent &&
    isNodeOfType(memberParent, "CallExpression") &&
    memberParent.callee === memberRoot
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
    return candidateNode.range[0] < getExecutionReferenceOffset(referenceNode);
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

export const hasPossibleStaticPropertyMutationOrEscapeBefore = (
  identifier: EsTreeNode,
  propertyName: string,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (hasPossibleStaticPropertyWriteBefore(identifier, propertyName, referenceNode, scopes)) {
    return true;
  }
  return getPotentiallyAliasedSymbols(identifier, scopes).some((symbol) =>
    symbol.references.some(
      (reference) =>
        !isNonMutatingStaticPropertyReference(reference.identifier) &&
        canExecuteBefore(reference.identifier, referenceNode, scopes),
    ),
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
