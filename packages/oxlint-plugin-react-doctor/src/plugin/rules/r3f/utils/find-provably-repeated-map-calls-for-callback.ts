import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import {
  ARRAY_MAP_CALLBACK_ARGUMENT_INDEX,
  MINIMUM_PROVABLY_REPEATED_ITEM_COUNT,
} from "../constants.js";

const isProvablyRepeatedMapCall = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.computed ||
    !isNodeOfType(call.callee.property, "Identifier") ||
    call.callee.property.name !== "map"
  ) {
    return false;
  }
  const collection = stripParenExpression(call.callee.object);
  return (
    isNodeOfType(collection, "ArrayExpression") &&
    collection.elements.length >= MINIMUM_PROVABLY_REPEATED_ITEM_COUNT &&
    collection.elements.every((element) => element && !isNodeOfType(element, "SpreadElement"))
  );
};

const getCallbackSymbol = (
  functionNode: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null | undefined => {
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const declaration = functionRoot.parent;
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    return context.scopes.scopeFor(functionNode).symbolsByName.get(functionNode.id.name);
  }
  if (
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.init === functionRoot &&
    isNodeOfType(declaration.id, "Identifier")
  ) {
    return context.scopes.symbolFor(declaration.id);
  }
  return null;
};

export const findProvablyRepeatedMapCallsForCallback = (
  functionNode: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression">[] => {
  const repeatedMapCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const directCall = functionRoot.parent;
  if (
    isNodeOfType(directCall, "CallExpression") &&
    directCall.arguments[ARRAY_MAP_CALLBACK_ARGUMENT_INDEX] === functionRoot &&
    isProvablyRepeatedMapCall(directCall)
  ) {
    repeatedMapCalls.push(directCall);
  }
  const callbackSymbol = getCallbackSymbol(functionNode, context);
  if (!callbackSymbol) return repeatedMapCalls;
  for (const reference of callbackSymbol.references) {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const call = referenceRoot.parent;
    if (
      isNodeOfType(call, "CallExpression") &&
      call.arguments[ARRAY_MAP_CALLBACK_ARGUMENT_INDEX] === referenceRoot &&
      resolveExactLocalFunction(referenceRoot, context.scopes) === functionNode &&
      isProvablyRepeatedMapCall(call)
    ) {
      repeatedMapCalls.push(call);
    }
  }
  return repeatedMapCalls;
};
