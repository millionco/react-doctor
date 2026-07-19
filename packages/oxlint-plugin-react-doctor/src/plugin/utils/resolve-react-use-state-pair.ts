import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { resolveConstIdentifierRootSymbol } from "./resolve-const-identifier-root-symbol.js";

export interface ReactUseStatePair {
  readonly declarator: EsTreeNodeOfType<"VariableDeclarator">;
  readonly stateSymbol: SymbolDescriptor | null;
  readonly setterSymbol: SymbolDescriptor;
}

export const resolveReactUseStatePair = (
  setterIdentifier: EsTreeNode,
  scopes: ScopeAnalysis,
): ReactUseStatePair | null => {
  const setterSymbol = resolveConstIdentifierRootSymbol(setterIdentifier, scopes);
  if (!setterSymbol || !isNodeOfType(setterSymbol.declarationNode, "VariableDeclarator")) {
    return null;
  }
  const declarator = setterSymbol.declarationNode;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return null;
  const stateElement = declarator.id.elements?.[0];
  const setterElement = declarator.id.elements?.[1];
  if (
    !isNodeOfType(setterElement, "Identifier") ||
    setterSymbol.bindingIdentifier !== setterElement ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !isReactApiCall(declarator.init, "useState", scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    })
  ) {
    return null;
  }
  const stateSymbol = isNodeOfType(stateElement, "Identifier")
    ? scopes.symbolFor(stateElement)
    : null;
  return { declarator, stateSymbol, setterSymbol };
};
