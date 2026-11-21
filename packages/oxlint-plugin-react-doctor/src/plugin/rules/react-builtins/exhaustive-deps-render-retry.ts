import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import { unwrapExpression } from "./exhaustive-deps-low-level.js";

const isReadonlyBinding = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => reference.flag === "read");

const isNamedReactCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = unwrapExpression(call.callee);
  if (call.optional || !isNodeOfType(callee, "Identifier")) return false;
  const importSpecifier = scopes.symbolFor(callee)?.declarationNode;
  const importDeclaration = importSpecifier?.parent;
  return (
    isNodeOfType(importSpecifier, "ImportSpecifier") &&
    importSpecifier.importKind !== "type" &&
    isNodeOfType(importDeclaration, "ImportDeclaration") &&
    importDeclaration.importKind !== "type" &&
    importDeclaration.source.value === "react" &&
    getImportedName(importSpecifier) === name
  );
};

const getLocalStatePair = (
  symbol: SymbolDescriptor | null,
  body: EsTreeNode,
  scopes: ScopeAnalysis,
) => {
  if (symbol?.kind !== "const" || !isReadonlyBinding(symbol)) return null;
  const declarator = symbol.declarationNode;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.parent?.parent !== body ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements[0] !== symbol.bindingIdentifier ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !isNamedReactCall(declarator.init, "useState", scopes)
  ) {
    return null;
  }
  const setter = declarator.id.elements[1];
  if (!isNodeOfType(setter, "Identifier")) return null;
  const pair = resolveReactUseStatePair(setter, scopes);
  return pair?.stateSymbol === symbol ? { setter: pair.setterSymbol, call: declarator.init } : null;
};

const getIdentifierSymbol = (expression: EsTreeNode, scopes: ScopeAnalysis) => {
  const identifier = unwrapExpression(expression);
  return isNodeOfType(identifier, "Identifier") ? scopes.symbolFor(identifier) : null;
};

export const isDiscardedRenderArrayDependency = (
  effect: EsTreeNodeOfType<"CallExpression">,
  dependency: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const initializer = getDirectConstInitializer(dependency);
  if (!initializer || !isReadonlyBinding(dependency)) return false;
  const selection = unwrapExpression(initializer);
  if (!isNodeOfType(selection, "ConditionalExpression")) return false;
  const freshArray = unwrapExpression(selection.consequent);
  if (!isNodeOfType(freshArray, "ArrayExpression") || freshArray.elements.length !== 0)
    return false;
  const effectStatement = effect.parent;
  const component = findEnclosingFunction(effect);
  const componentBody = effectStatement?.parent;
  const dependencyStatement = dependency.declarationNode.parent;
  if (
    !isNodeOfType(effectStatement, "ExpressionStatement") ||
    !isNodeOfType(componentBody, "BlockStatement") ||
    componentBody.parent !== component ||
    !isNodeOfType(dependencyStatement, "VariableDeclaration") ||
    dependencyStatement.parent !== componentBody ||
    !isNamedReactCall(effect, "useEffect", scopes) ||
    !getLocalStatePair(getIdentifierSymbol(selection.alternate, scopes), componentBody, scopes)
  ) {
    return false;
  }
  const guard = getIdentifierSymbol(selection.test, scopes);
  if (
    !guard ||
    !isReadonlyBinding(guard) ||
    guard.declarationNode.parent?.parent !== componentBody
  ) {
    return false;
  }
  const guardInitializer = getDirectConstInitializer(guard);
  const comparison = guardInitializer && unwrapExpression(guardInitializer);
  if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "!==") return false;
  const left = getIdentifierSymbol(comparison.left, scopes);
  const right = getIdentifierSymbol(comparison.right, scopes);
  const incoming = left?.kind === "parameter" ? left : right;
  const previous = incoming === left ? right : left;
  if (
    incoming?.kind !== "parameter" ||
    incoming.scope.node !== component ||
    !isReadonlyBinding(incoming)
  ) {
    return false;
  }
  const tracker = getLocalStatePair(previous, componentBody, scopes);
  const initialValue = tracker?.call.arguments[0];
  if (!tracker || !initialValue || getIdentifierSymbol(initialValue, scopes) !== incoming)
    return false;
  const setterReference = tracker.setter.references[0];
  if (tracker.setter.references.length !== 1 || setterReference?.flag !== "read") return false;
  const setterCall = setterReference.identifier.parent;
  if (
    !isNodeOfType(setterCall, "CallExpression") ||
    setterCall.callee !== setterReference.identifier ||
    setterCall.optional ||
    setterCall.arguments.length !== 1 ||
    getIdentifierSymbol(setterCall.arguments[0], scopes) !== incoming
  ) {
    return false;
  }
  const setterStatement = setterCall.parent;
  const setterBlock = setterStatement?.parent;
  const setterGuard = setterBlock?.parent;
  if (
    !isNodeOfType(setterStatement, "ExpressionStatement") ||
    !isNodeOfType(setterBlock, "BlockStatement") ||
    setterBlock.body[0] !== setterStatement ||
    !isNodeOfType(setterGuard, "IfStatement") ||
    setterGuard.consequent !== setterBlock ||
    setterGuard.alternate ||
    setterGuard.parent !== componentBody ||
    getIdentifierSymbol(setterGuard.test, scopes) !== guard
  ) {
    return false;
  }
  // React retries render-phase state updates before running passive effects.
  const statements: ReadonlyArray<EsTreeNode> = componentBody.body;
  const guardIndex = statements.indexOf(setterGuard);
  const dependencyIndex = statements.indexOf(dependencyStatement);
  return guardIndex < dependencyIndex && dependencyIndex < statements.indexOf(effectStatement);
};
