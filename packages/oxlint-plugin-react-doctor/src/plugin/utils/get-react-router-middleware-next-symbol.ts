import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getFunctionBindingIdentifier } from "./get-function-binding-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

const isExportedMiddlewareArray = (node: EsTreeNode | null | undefined): boolean => {
  if (!isNodeOfType(node, "ArrayExpression")) return false;
  const declarator = node.parent;
  if (!isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (!isNodeOfType(declarator.id, "Identifier") || declarator.id.name !== "middleware") {
    return false;
  }
  return isNodeOfType(declarator.parent?.parent, "ExportNamedDeclaration");
};

const isServerMiddlewareFunction = (context: RuleContext, functionNode: EsTreeNode): boolean => {
  if (isExportedMiddlewareArray(functionNode.parent)) return true;
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (bindingIdentifier === null) return false;
  const bindingSymbol = context.scopes.symbolFor(bindingIdentifier);
  if (bindingSymbol === null) return false;
  return bindingSymbol.references.some((reference) =>
    isExportedMiddlewareArray(reference.identifier.parent),
  );
};

export const getReactRouterMiddlewareNextSymbol = (
  context: RuleContext,
  functionNode: EsTreeNode,
): SymbolDescriptor | null => {
  if (!isFunctionLike(functionNode) || !isServerMiddlewareFunction(context, functionNode)) {
    return null;
  }
  const nextParameter = functionNode.params?.[1];
  if (!isNodeOfType(nextParameter, "Identifier")) return null;
  return context.scopes.symbolFor(nextParameter);
};
