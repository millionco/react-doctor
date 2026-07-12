import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { functionContainsReactRenderOutput } from "./function-contains-react-render-output.js";
import { isComponentDeclaration } from "./is-component-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenReactClassComponent } from "./is-proven-react-class-component.js";
import { isUppercaseName } from "./is-uppercase-name.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isProvenReactComponentSymbol = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const candidateSymbols =
    symbol.kind === "ts-module"
      ? symbol.scope.symbols.filter(
          (candidateSymbol) =>
            candidateSymbol.name === symbol.name && candidateSymbol.kind !== "ts-module",
        )
      : [symbol];
  for (const candidateSymbol of candidateSymbols) {
    if (isComponentDeclaration(candidateSymbol.declarationNode)) {
      if (functionContainsReactRenderOutput(candidateSymbol.declarationNode, scopes)) return true;
      continue;
    }
    const initializer = candidateSymbol.initializer
      ? stripParenExpression(candidateSymbol.initializer)
      : null;
    if (
      isNodeOfType(candidateSymbol.declarationNode, "VariableDeclarator") &&
      isNodeOfType(candidateSymbol.declarationNode.id, "Identifier") &&
      isUppercaseName(candidateSymbol.declarationNode.id.name) &&
      initializer &&
      (isNodeOfType(initializer, "ArrowFunctionExpression") ||
        isNodeOfType(initializer, "FunctionExpression"))
    ) {
      if (functionContainsReactRenderOutput(initializer, scopes)) return true;
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
