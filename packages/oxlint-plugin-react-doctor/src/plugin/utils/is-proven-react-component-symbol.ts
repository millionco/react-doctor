import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { functionContainsReactRenderOutput } from "./function-contains-react-render-output.js";
import { functionContainsProvenReactHookCall } from "./function-contains-proven-react-hook-call.js";
import { hasSymbolWriteBefore } from "./has-symbol-write-before.js";
import { isComponentDeclaration } from "./is-component-declaration.js";
import { isInlineFunctionExpression } from "./is-inline-function-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenReactClassComponent } from "./is-proven-react-class-component.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isUppercaseName } from "./is-uppercase-name.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const REACT_COMPONENT_HOC_NAMES: ReadonlySet<string> = new Set(["memo", "forwardRef"]);

const functionHasComponentEvidence = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  functionContainsReactRenderOutput(functionNode, scopes) ||
  functionContainsProvenReactHookCall(functionNode, scopes);

const isProvenReactComponentExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isInlineFunctionExpression(candidate)) {
    return functionHasComponentEvidence(candidate, scopes);
  }
  if (isNodeOfType(candidate, "ClassExpression")) {
    return isProvenReactClassComponent(candidate, scopes);
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (!symbol || visitedSymbolIds.has(symbol.id) || hasSymbolWriteBefore(symbol, candidate)) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    if (isNodeOfType(symbol.declarationNode, "FunctionDeclaration")) {
      return functionHasComponentEvidence(symbol.declarationNode, scopes);
    }
    if (
      isNodeOfType(symbol.declarationNode, "ClassDeclaration") ||
      isNodeOfType(symbol.declarationNode, "ClassExpression")
    ) {
      return isProvenReactClassComponent(symbol.declarationNode, scopes);
    }
    return Boolean(
      symbol.initializer &&
      isProvenReactComponentExpression(symbol.initializer, scopes, visitedSymbolIds),
    );
  }
  if (!isNodeOfType(candidate, "CallExpression")) return false;
  if (
    isReactApiCall(candidate, REACT_COMPONENT_HOC_NAMES, scopes, {
      resolveNamedAliases: true,
    })
  ) {
    const wrappedComponent = candidate.arguments[0];
    return Boolean(
      wrappedComponent &&
      !isNodeOfType(wrappedComponent, "SpreadElement") &&
      isProvenReactComponentExpression(wrappedComponent, scopes, visitedSymbolIds),
    );
  }
  if (!isReactApiCall(candidate, "useMemo", scopes, { resolveNamedAliases: true })) return false;
  const factory = candidate.arguments[0];
  if (!factory || isNodeOfType(factory, "SpreadElement")) return false;
  const unwrappedFactory = stripParenExpression(factory);
  if (!isInlineFunctionExpression(unwrappedFactory)) return false;
  if (!isNodeOfType(unwrappedFactory.body, "BlockStatement")) {
    return isProvenReactComponentExpression(unwrappedFactory.body, scopes, visitedSymbolIds);
  }
  const returnStatements = collectFunctionReturnStatements(unwrappedFactory);
  const returnedExpression = returnStatements[0]?.argument;
  return Boolean(
    returnStatements.length === 1 &&
    returnedExpression &&
    isProvenReactComponentExpression(returnedExpression, scopes, visitedSymbolIds),
  );
};

export const isProvenReactComponentSymbol = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  componentReference: EsTreeNode,
): boolean => {
  const candidateSymbols =
    symbol.kind === "ts-module"
      ? symbol.scope.symbols.filter(
          (candidateSymbol) =>
            candidateSymbol.name === symbol.name && candidateSymbol.kind !== "ts-module",
        )
      : [symbol];
  for (const candidateSymbol of candidateSymbols) {
    if (hasSymbolWriteBefore(candidateSymbol, componentReference)) continue;
    if (isComponentDeclaration(candidateSymbol.declarationNode)) {
      if (functionHasComponentEvidence(candidateSymbol.declarationNode, scopes)) return true;
      continue;
    }
    const initializer = candidateSymbol.initializer
      ? stripParenExpression(candidateSymbol.initializer)
      : null;
    if (
      isNodeOfType(candidateSymbol.declarationNode, "VariableDeclarator") &&
      isNodeOfType(candidateSymbol.declarationNode.id, "Identifier") &&
      isUppercaseName(candidateSymbol.declarationNode.id.name) &&
      initializer
    ) {
      if (isProvenReactComponentExpression(initializer, scopes)) return true;
      continue;
    }
    if (
      isNodeOfType(candidateSymbol.declarationNode, "ClassDeclaration") ||
      isNodeOfType(candidateSymbol.declarationNode, "ClassExpression")
    ) {
      if (isProvenReactClassComponent(candidateSymbol.declarationNode, scopes)) return true;
      continue;
    }
    if (
      initializer &&
      isNodeOfType(initializer, "ClassExpression") &&
      isProvenReactClassComponent(initializer, scopes)
    ) {
      return true;
    }
  }
  return false;
};
