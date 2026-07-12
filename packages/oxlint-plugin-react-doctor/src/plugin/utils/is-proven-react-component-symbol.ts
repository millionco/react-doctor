import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { functionContainsReactRenderOutput } from "./function-contains-react-render-output.js";
import { isComponentAssignment } from "./is-component-assignment.js";
import { isComponentDeclaration } from "./is-component-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenReactClassComponent } from "./is-proven-react-class-component.js";

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
    if (isComponentAssignment(candidateSymbol.declarationNode) && candidateSymbol.initializer) {
      if (functionContainsReactRenderOutput(candidateSymbol.initializer, scopes)) return true;
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
      candidateSymbol.initializer &&
      isNodeOfType(candidateSymbol.initializer, "ClassExpression") &&
      isProvenReactClassComponent(candidateSymbol.initializer, scopes)
    ) {
      return true;
    }
  }
  return false;
};
