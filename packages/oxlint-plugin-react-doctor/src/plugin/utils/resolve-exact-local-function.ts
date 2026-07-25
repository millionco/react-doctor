import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOnUnconditionalPath } from "./is-node-on-unconditional-path.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface MemberFunctionMutation {
  assignedExpression: EsTreeNode | null;
  isDefinite: boolean;
  offset: number;
}

interface MemberFunctionResolution {
  exactFunction: EsTreeNode | null;
  possibleFunctions: EsTreeNode[];
}

const getExecutionBoundary = (node: EsTreeNode): EsTreeNode | null =>
  findEnclosingFunction(node) ?? findProgramRoot(node);

const isConstAliasSourceReference = (identifier: EsTreeNode): boolean => {
  const referenceRoot = findTransparentExpressionRoot(identifier);
  const parent = referenceRoot.parent;
  return Boolean(
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === referenceRoot &&
    parent.parent &&
    isNodeOfType(parent.parent, "VariableDeclaration") &&
    parent.parent.kind === "const",
  );
};

const isMemberWrite = (memberExpression: EsTreeNode): boolean => {
  const memberRoot = findTransparentExpressionRoot(memberExpression);
  const parent = memberRoot.parent;
  return Boolean(
    parent &&
    ((isNodeOfType(parent, "AssignmentExpression") && parent.left === memberRoot) ||
      (isNodeOfType(parent, "UpdateExpression") && parent.argument === memberRoot) ||
      (isNodeOfType(parent, "UnaryExpression") &&
        parent.operator === "delete" &&
        parent.argument === memberRoot)),
  );
};

const getReceiverMember = (identifier: EsTreeNode): EsTreeNode | null => {
  const receiver = findTransparentExpressionRoot(identifier);
  const parent = receiver.parent;
  return parent &&
    isNodeOfType(parent, "MemberExpression") &&
    stripParenExpression(parent.object) === receiver
    ? parent
    : null;
};

const resolveObjectPropertyFunction = (
  objectExpression: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode | null => {
  if (!isNodeOfType(objectExpression, "ObjectExpression")) return null;
  for (const property of objectExpression.properties.toReversed()) {
    if (!isNodeOfType(property, "Property")) return null;
    const candidatePropertyName = getResolvedStaticPropertyName(property, scopes);
    if (candidatePropertyName === null) return null;
    if (candidatePropertyName !== propertyName) continue;
    if (property.kind !== "init") return null;
    return resolveExactLocalFunctionInternal(property.value, scopes, visitedSymbolIds);
  }
  return null;
};

const resolvePossibleObjectPropertyFunctions = (
  objectExpression: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode[] => {
  if (!isNodeOfType(objectExpression, "ObjectExpression")) return [];
  let possibleFunctions: EsTreeNode[] = [];
  const possibleFunctionSet = new Set<EsTreeNode>();
  for (const property of objectExpression.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const candidatePropertyName = getResolvedStaticPropertyName(property, scopes);
    const candidateFunction =
      property.kind === "init" || property.kind === "get"
        ? resolveExactLocalFunctionInternal(property.value, scopes, new Set(visitedSymbolIds))
        : null;
    if (candidatePropertyName === propertyName) {
      possibleFunctions = candidateFunction ? [candidateFunction] : [];
      possibleFunctionSet.clear();
      if (candidateFunction) possibleFunctionSet.add(candidateFunction);
    } else if (
      candidatePropertyName === null &&
      candidateFunction &&
      !possibleFunctionSet.has(candidateFunction)
    ) {
      possibleFunctions.push(candidateFunction);
      possibleFunctionSet.add(candidateFunction);
    }
  }
  return possibleFunctions;
};

const resolveStaticClassFunction = (
  classNode: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode | null => {
  if (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) {
    return null;
  }
  for (const classElement of classNode.body.body.toReversed()) {
    if (
      (!isNodeOfType(classElement, "MethodDefinition") &&
        !isNodeOfType(classElement, "PropertyDefinition")) ||
      !classElement.static
    ) {
      continue;
    }
    const candidatePropertyName = getResolvedStaticPropertyName(classElement, scopes);
    if (candidatePropertyName === null) return null;
    if (candidatePropertyName !== propertyName) continue;
    if (isNodeOfType(classElement, "MethodDefinition") && classElement.kind !== "method") {
      return null;
    }
    return classElement.value
      ? resolveExactLocalFunctionInternal(classElement.value, scopes, visitedSymbolIds)
      : null;
  }
  return null;
};

const resolvePossibleStaticClassFunctions = (
  classNode: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode[] => {
  if (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) {
    return [];
  }
  let possibleFunctions: EsTreeNode[] = [];
  const possibleFunctionSet = new Set<EsTreeNode>();
  for (const classElement of classNode.body.body) {
    if (
      (!isNodeOfType(classElement, "MethodDefinition") &&
        !isNodeOfType(classElement, "PropertyDefinition")) ||
      !classElement.static
    ) {
      continue;
    }
    const candidatePropertyName = getResolvedStaticPropertyName(classElement, scopes);
    const candidateFunction =
      classElement.value &&
      (!isNodeOfType(classElement, "MethodDefinition") ||
        classElement.kind === "method" ||
        classElement.kind === "get")
        ? resolveExactLocalFunctionInternal(classElement.value, scopes, new Set(visitedSymbolIds))
        : null;
    if (candidatePropertyName === propertyName) {
      possibleFunctions = candidateFunction ? [candidateFunction] : [];
      possibleFunctionSet.clear();
      if (candidateFunction) possibleFunctionSet.add(candidateFunction);
    } else if (
      candidatePropertyName === null &&
      candidateFunction &&
      !possibleFunctionSet.has(candidateFunction)
    ) {
      possibleFunctions.push(candidateFunction);
      possibleFunctionSet.add(candidateFunction);
    }
  }
  return possibleFunctions;
};

const resolveAssignedMemberFunction = (
  receiver: EsTreeNode,
  memberExpression: EsTreeNode,
  propertyName: string,
  initialFunction: EsTreeNode | null,
  initialPossibleFunctions: EsTreeNode[],
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): MemberFunctionResolution => {
  const callBoundary = getExecutionBoundary(memberExpression);
  if (!callBoundary || !isNodeOfType(receiver, "Identifier")) {
    return { exactFunction: null, possibleFunctions: [] };
  }
  const mutations: MemberFunctionMutation[] = [];
  for (const symbol of getEquivalentSymbols(receiver, scopes)) {
    for (const reference of symbol.references) {
      const identifier = reference.identifier;
      if (identifier.range[0] >= memberExpression.range[0]) continue;
      if (isConstAliasSourceReference(identifier)) continue;
      const candidateMember = getReceiverMember(identifier);
      if (!candidateMember) {
        if (getExecutionBoundary(identifier) === callBoundary) {
          mutations.push({
            assignedExpression: null,
            isDefinite: false,
            offset: identifier.range[0],
          });
        }
        continue;
      }
      if (!isMemberWrite(candidateMember)) continue;
      const writeBoundary = getExecutionBoundary(candidateMember);
      if (writeBoundary !== callBoundary) continue;
      const assignedPropertyName = getResolvedStaticPropertyName(candidateMember, scopes);
      const assignment = findTransparentExpressionRoot(candidateMember).parent;
      const assignedExpression =
        assignment &&
        isNodeOfType(assignment, "AssignmentExpression") &&
        assignment.operator === "="
          ? assignment.right
          : null;
      if (assignedPropertyName === null) {
        mutations.push({
          assignedExpression,
          isDefinite: false,
          offset: candidateMember.range[0],
        });
        continue;
      }
      if (assignedPropertyName !== propertyName) continue;
      if (
        !assignment ||
        !isNodeOfType(assignment, "AssignmentExpression") ||
        assignment.operator !== "=" ||
        !isNodeOnUnconditionalPath(candidateMember, callBoundary)
      ) {
        mutations.push({
          assignedExpression,
          isDefinite: false,
          offset: candidateMember.range[0],
        });
        continue;
      }
      mutations.push({
        assignedExpression,
        isDefinite: true,
        offset: assignment.range[0],
      });
    }
  }
  mutations.sort((firstMutation, secondMutation) => firstMutation.offset - secondMutation.offset);
  let exactFunction = initialFunction;
  let possibleFunctions = initialPossibleFunctions;
  const possibleFunctionSet = new Set(initialPossibleFunctions);
  for (const mutation of mutations) {
    const assignedFunction = mutation.assignedExpression
      ? resolveExactLocalFunctionInternal(
          mutation.assignedExpression,
          scopes,
          new Set(visitedSymbolIds),
        )
      : null;
    if (mutation.isDefinite) {
      exactFunction = assignedFunction;
      possibleFunctions = assignedFunction ? [assignedFunction] : [];
      possibleFunctionSet.clear();
      if (assignedFunction) possibleFunctionSet.add(assignedFunction);
      continue;
    }
    exactFunction = null;
    if (assignedFunction && !possibleFunctionSet.has(assignedFunction)) {
      possibleFunctions.push(assignedFunction);
      possibleFunctionSet.add(assignedFunction);
    }
  }
  return { exactFunction, possibleFunctions };
};

const resolveMemberFunction = (
  memberExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): MemberFunctionResolution => {
  if (!isNodeOfType(memberExpression, "MemberExpression")) {
    return { exactFunction: null, possibleFunctions: [] };
  }
  const propertyName = getStaticPropertyName(memberExpression);
  if (propertyName === null) return { exactFunction: null, possibleFunctions: [] };
  const receiver = stripParenExpression(memberExpression.object);
  if (isNodeOfType(receiver, "ObjectExpression")) {
    const exactFunction = resolveObjectPropertyFunction(
      receiver,
      propertyName,
      scopes,
      visitedSymbolIds,
    );
    return {
      exactFunction,
      possibleFunctions: resolvePossibleObjectPropertyFunctions(
        receiver,
        propertyName,
        scopes,
        visitedSymbolIds,
      ),
    };
  }
  if (isNodeOfType(receiver, "ClassExpression")) {
    const exactFunction = resolveStaticClassFunction(
      receiver,
      propertyName,
      scopes,
      visitedSymbolIds,
    );
    return {
      exactFunction,
      possibleFunctions: resolvePossibleStaticClassFunctions(
        receiver,
        propertyName,
        scopes,
        visitedSymbolIds,
      ),
    };
  }
  if (!isNodeOfType(receiver, "Identifier")) {
    return { exactFunction: null, possibleFunctions: [] };
  }
  const receiverSymbol = resolveConstIdentifierAlias(receiver, scopes);
  if (!receiverSymbol || visitedSymbolIds.has(receiverSymbol.id)) {
    return { exactFunction: null, possibleFunctions: [] };
  }
  visitedSymbolIds.add(receiverSymbol.id);
  let initialFunction: EsTreeNode | null = null;
  let initialPossibleFunctions: EsTreeNode[] = [];
  if (receiverSymbol.kind === "const" && receiverSymbol.initializer) {
    const initializer = stripParenExpression(receiverSymbol.initializer);
    initialFunction = resolveObjectPropertyFunction(
      initializer,
      propertyName,
      scopes,
      visitedSymbolIds,
    );
    initialPossibleFunctions = resolvePossibleObjectPropertyFunctions(
      initializer,
      propertyName,
      scopes,
      visitedSymbolIds,
    );
  } else if (receiverSymbol.kind === "class" && receiverSymbol.initializer) {
    initialFunction = resolveStaticClassFunction(
      receiverSymbol.initializer,
      propertyName,
      scopes,
      visitedSymbolIds,
    );
    initialPossibleFunctions = resolvePossibleStaticClassFunctions(
      receiverSymbol.initializer,
      propertyName,
      scopes,
      visitedSymbolIds,
    );
  }
  return resolveAssignedMemberFunction(
    receiver,
    memberExpression,
    propertyName,
    initialFunction,
    initialPossibleFunctions,
    scopes,
    visitedSymbolIds,
  );
};

const resolvePossibleLocalFunctionsInternal = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode[] => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    const callee = stripParenExpression(unwrappedExpression.callee);
    return isNodeOfType(callee, "MemberExpression") && getStaticPropertyName(callee) === "bind"
      ? resolvePossibleLocalFunctionsInternal(callee.object, scopes, visitedSymbolIds)
      : [];
  }
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    const propertyName = getStaticPropertyName(unwrappedExpression);
    if (propertyName === "call" || propertyName === "apply") {
      return resolvePossibleLocalFunctionsInternal(
        unwrappedExpression.object,
        scopes,
        visitedSymbolIds,
      );
    }
    return resolveMemberFunction(unwrappedExpression, scopes, visitedSymbolIds).possibleFunctions;
  }
  const exactFunction = resolveExactLocalFunctionInternal(
    unwrappedExpression,
    scopes,
    visitedSymbolIds,
  );
  return exactFunction ? [exactFunction] : [];
};

const resolveExactLocalFunctionInternal = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): EsTreeNode | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isFunctionLike(unwrappedExpression)) return unwrappedExpression;
  if (isNodeOfType(unwrappedExpression, "CallExpression")) {
    const callee = stripParenExpression(unwrappedExpression.callee);
    if (isNodeOfType(callee, "MemberExpression") && getStaticPropertyName(callee) === "bind") {
      return resolveExactLocalFunctionInternal(callee.object, scopes, visitedSymbolIds);
    }
    return null;
  }
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    const propertyName = getStaticPropertyName(unwrappedExpression);
    if (propertyName === "call" || propertyName === "apply") {
      return resolveExactLocalFunctionInternal(
        unwrappedExpression.object,
        scopes,
        visitedSymbolIds,
      );
    }
    return resolveMemberFunction(unwrappedExpression, scopes, visitedSymbolIds).exactFunction;
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(unwrappedExpression, scopes);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  visitedSymbolIds.add(symbol.id);
  if (symbol.kind === "function") {
    const isReassigned = symbol.references.some((reference) => reference.flag !== "read");
    return !isReassigned && isFunctionLike(symbol.declarationNode) ? symbol.declarationNode : null;
  }
  if (symbol.kind !== "const" || !symbol.initializer) return null;
  return resolveExactLocalFunctionInternal(symbol.initializer, scopes, visitedSymbolIds);
};

export const resolveExactLocalFunction = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => resolveExactLocalFunctionInternal(expression, scopes, new Set());

export const resolvePossibleLocalFunctions = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode[] => resolvePossibleLocalFunctionsInternal(expression, scopes, new Set());
