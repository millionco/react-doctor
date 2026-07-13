import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { ControlFlowAnalysis } from "../semantic/control-flow-graph.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { functionContainsReactRenderOutput } from "./function-contains-react-render-output.js";
import { functionContainsProvenReactHookCall } from "./function-contains-proven-react-hook-call.js";
import { functionReturnsPropsChildren } from "./function-returns-props-children.js";
import { functionReturnsOnlyNull } from "./function-returns-only-null.js";
import { hasStableCallTarget } from "./has-stable-call-target.js";
import { hasSymbolWriteBefore } from "./has-symbol-write-before.js";
import { isComponentDeclaration } from "./is-component-declaration.js";
import { isInlineFunctionExpression } from "./is-inline-function-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenReactClassComponent } from "./is-proven-react-class-component.js";
import { isProvenStyledComponentExpression } from "./is-proven-styled-component-expression.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isUppercaseName } from "./is-uppercase-name.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const REACT_COMPONENT_HOC_NAMES: ReadonlySet<string> = new Set(["memo", "forwardRef"]);

const functionHasComponentEvidence = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  controlFlow: ControlFlowAnalysis,
): boolean =>
  functionContainsReactRenderOutput(functionNode, scopes, controlFlow) ||
  functionReturnsPropsChildren(functionNode, scopes, controlFlow) ||
  (functionContainsProvenReactHookCall(functionNode, scopes) &&
    functionReturnsOnlyNull(functionNode));

const isProvenReactComponentExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  controlFlow: ControlFlowAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isInlineFunctionExpression(candidate)) {
    return functionHasComponentEvidence(candidate, scopes, controlFlow);
  }
  if (isNodeOfType(candidate, "ClassExpression")) {
    return isProvenReactClassComponent(candidate, scopes);
  }
  if (isProvenStyledComponentExpression(candidate, scopes)) return true;
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      hasSymbolWriteBefore(symbol, candidate, scopes)
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    if (isNodeOfType(symbol.declarationNode, "FunctionDeclaration")) {
      return functionHasComponentEvidence(symbol.declarationNode, scopes, controlFlow);
    }
    if (
      isNodeOfType(symbol.declarationNode, "ClassDeclaration") ||
      isNodeOfType(symbol.declarationNode, "ClassExpression")
    ) {
      return isProvenReactClassComponent(symbol.declarationNode, scopes);
    }
    return Boolean(
      symbol.initializer &&
      isProvenReactComponentExpression(symbol.initializer, scopes, controlFlow, visitedSymbolIds),
    );
  }
  if (!isNodeOfType(candidate, "CallExpression")) return false;
  if (!hasStableCallTarget(candidate, scopes)) return false;
  if (isReactApiCall(candidate, REACT_COMPONENT_HOC_NAMES, scopes, { resolveNamedAliases: true })) {
    const wrappedComponent = candidate.arguments[0];
    return Boolean(
      wrappedComponent &&
      !isNodeOfType(wrappedComponent, "SpreadElement") &&
      isProvenReactComponentExpression(wrappedComponent, scopes, controlFlow, visitedSymbolIds),
    );
  }
  if (!isReactApiCall(candidate, "useMemo", scopes, { resolveNamedAliases: true })) return false;
  const factory = candidate.arguments[0];
  if (!factory || isNodeOfType(factory, "SpreadElement")) return false;
  const unwrappedFactory = stripParenExpression(factory);
  if (!isInlineFunctionExpression(unwrappedFactory)) return false;
  if (!isNodeOfType(unwrappedFactory.body, "BlockStatement")) {
    return isProvenReactComponentExpression(
      unwrappedFactory.body,
      scopes,
      controlFlow,
      visitedSymbolIds,
    );
  }
  const returnStatements = collectFunctionReturnStatements(unwrappedFactory);
  const returnedExpression = returnStatements[0]?.argument;
  return Boolean(
    returnStatements.length === 1 &&
    returnedExpression &&
    isProvenReactComponentExpression(returnedExpression, scopes, controlFlow, visitedSymbolIds),
  );
};

export const isProvenReactComponentSymbol = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  controlFlow: ControlFlowAnalysis,
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
    if (hasSymbolWriteBefore(candidateSymbol, componentReference, scopes)) continue;
    if (isComponentDeclaration(candidateSymbol.declarationNode)) {
      if (functionHasComponentEvidence(candidateSymbol.declarationNode, scopes, controlFlow)) {
        return true;
      }
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
      if (isProvenReactComponentExpression(initializer, scopes, controlFlow)) return true;
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
