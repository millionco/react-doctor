import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { hasPossibleStaticPropertyWrite } from "../../../utils/has-static-property-write-before.js";
import { isSynchronousIteratorCall } from "../../../utils/is-synchronous-iterator-callback.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isNodeConditionallyExecuted } from "../../../utils/is-node-conditionally-executed.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";

const isUseTransitionCall = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "CallExpression")) return false;
  const provenance = getApiReferenceProvenance(candidate.callee, scopes);
  return provenance?.moduleSource === "react" && provenance.apiName === "useTransition";
};

const isUseTransitionTuple = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isUseTransitionCall(candidate, scopes)) return true;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isUseTransitionTuple(symbol.initializer, scopes, visitedSymbolIds);
};

const resolvesToUseTransitionStarter = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "MemberExpression")) {
    const property = stripParenExpression(candidate.property);
    if (!candidate.computed || !isNodeOfType(property, "Literal") || property.value !== 1) {
      return false;
    }
    const tupleExpression = stripParenExpression(candidate.object);
    if (
      isNodeOfType(tupleExpression, "Identifier") &&
      hasPossibleStaticPropertyWrite(tupleExpression, "1", scopes)
    ) {
      return false;
    }
    return isUseTransitionTuple(tupleExpression, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  const declaration = symbol.declarationNode;
  if (
    isNodeOfType(declaration, "VariableDeclarator") &&
    isNodeOfType(declaration.id, "ArrayPattern") &&
    declaration.id.elements[1] === symbol.bindingIdentifier &&
    declaration.init &&
    isUseTransitionCall(declaration.init, scopes)
  ) {
    return true;
  }
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  return resolvesToUseTransitionStarter(symbol.initializer, scopes, visitedSymbolIds);
};

const getImmediateReactCallback = (call: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode | null => {
  if (!isNodeOfType(call, "CallExpression")) return null;
  const provenance = getApiReferenceProvenance(call.callee, scopes);
  const isImmediateImportedApi = Boolean(
    (provenance?.moduleSource === "react" && provenance.apiName === "startTransition") ||
    (provenance?.moduleSource === "react-dom" && provenance.apiName === "flushSync"),
  );
  if (!isImmediateImportedApi && !resolvesToUseTransitionStarter(call.callee, scopes)) return null;
  const callback = call.arguments[0];
  return callback && !isNodeOfType(callback, "SpreadElement") ? callback : null;
};

export const walkFunctionExecution = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitor: (node: EsTreeNode, isConditionallyExecuted: boolean) => void,
): void => {
  const conditionalityByReachableFunction = new Map<EsTreeNode, boolean>();
  const discoverFunction = (
    currentFunction: EsTreeNode,
    isConditionallyExecutedByCallSite: boolean,
  ): void => {
    if (!isFunctionLike(currentFunction) || currentFunction.generator) return;
    const previousConditionality = conditionalityByReachableFunction.get(currentFunction);
    if (
      previousConditionality === false ||
      previousConditionality === isConditionallyExecutedByCallSite
    ) {
      return;
    }
    conditionalityByReachableFunction.set(currentFunction, isConditionallyExecutedByCallSite);
    walkAst(currentFunction, (node) => {
      if (node !== currentFunction && isFunctionLike(node)) return false;
      const isConditionallyExecuted =
        isConditionallyExecutedByCallSite || isNodeConditionallyExecuted(node, currentFunction);
      if (!isNodeOfType(node, "CallExpression")) return;
      const calledFunction = resolveExactLocalFunction(node.callee, scopes);
      if (calledFunction) discoverFunction(calledFunction, isConditionallyExecuted);
      const immediateReactCallback = getImmediateReactCallback(node, scopes);
      if (immediateReactCallback) {
        const callback = resolveExactLocalFunction(immediateReactCallback, scopes);
        if (callback) discoverFunction(callback, isConditionallyExecuted);
      }
      for (const argument of node.arguments) {
        if (
          isNodeOfType(argument, "SpreadElement") ||
          !isSynchronousIteratorCall(node, argument, scopes)
        ) {
          continue;
        }
        const callback = resolveExactLocalFunction(argument, scopes);
        if (callback) discoverFunction(callback, isConditionallyExecuted);
      }
    });
  };
  discoverFunction(functionNode, false);
  for (const [
    reachableFunction,
    isConditionallyExecutedByCallSite,
  ] of conditionalityByReachableFunction) {
    walkAst(reachableFunction, (node) => {
      if (node !== reachableFunction && isFunctionLike(node)) return false;
      visitor(
        node,
        isConditionallyExecutedByCallSite || isNodeConditionallyExecuted(node, reachableFunction),
      );
    });
  }
};
