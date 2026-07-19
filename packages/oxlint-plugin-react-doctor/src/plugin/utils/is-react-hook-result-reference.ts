import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isReactHookResultReference = (
  identifier: EsTreeNode,
  hookNames: ReadonlySet<string>,
  destructureIndex: number | null,
  scopes: ScopeAnalysis,
): boolean => {
  const visitedSymbolIds = new Set<number>();
  let symbol = scopes.symbolFor(identifier);
  while (
    symbol?.kind === "const" &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    symbol.declarationNode.id === symbol.bindingIdentifier &&
    symbol.initializer
  ) {
    if (visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    const initializer = stripParenExpression(symbol.initializer);
    if (!isNodeOfType(initializer, "Identifier")) break;
    symbol = scopes.symbolFor(initializer);
  }
  if (!symbol || !isNodeOfType(symbol.declarationNode, "VariableDeclarator")) return false;
  const declarator = symbol.declarationNode;
  if (destructureIndex === null) {
    if (declarator.id !== symbol.bindingIdentifier) return false;
  } else {
    if (!isNodeOfType(declarator.id, "ArrayPattern")) return false;
    const element = declarator.id.elements?.[destructureIndex];
    const binding = isNodeOfType(element, "AssignmentPattern") ? element.left : element;
    if (binding !== symbol.bindingIdentifier) return false;
  }
  const initializer = declarator.init ? stripParenExpression(declarator.init) : null;
  return Boolean(
    initializer &&
    isNodeOfType(initializer, "CallExpression") &&
    isReactApiCall(initializer, hookNames, scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    }),
  );
};
