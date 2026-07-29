import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNullishExpression } from "./is-nullish-expression.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// `.click()` is excluded because forwarding activation to a hidden control
// leaves that action unreachable to keyboard users.
const FOCUS_FORWARDING_METHOD_NAMES: ReadonlySet<string> = new Set([
  "focus",
  "select",
  "stopPropagation",
  "preventDefault",
  "stopImmediatePropagation",
]);

const DOM_LOOKUP_METHOD_NAMES: ReadonlySet<string> = new Set(["getElementById", "querySelector"]);

const getCalledMethodName = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  const expression = isNodeOfType(node, "ChainExpression") ? (node.expression as EsTreeNode) : node;
  if (!isNodeOfType(expression, "CallExpression")) return null;
  const callee = expression.callee as EsTreeNode;
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const property = callee.property as EsTreeNode;
  return isNodeOfType(property, "Identifier") ? property.name : null;
};

const isFocusForwardingCall = (node: EsTreeNode | null | undefined): boolean => {
  const methodName = getCalledMethodName(node);
  return methodName !== null && FOCUS_FORWARDING_METHOD_NAMES.has(methodName);
};

const isDomLookupCall = (node: EsTreeNode | null | undefined): boolean => {
  const methodName = getCalledMethodName(node);
  return methodName !== null && DOM_LOOKUP_METHOD_NAMES.has(methodName);
};

const isClosestGuard = (node: EsTreeNode): boolean => getCalledMethodName(node) === "closest";

const isEmptyReturn = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "ReturnStatement")) return node.argument === null;
  if (!isNodeOfType(node, "BlockStatement") || node.body.length !== 1) return false;
  return isEmptyReturn(node.body[0] as EsTreeNode);
};

const isClosestReturnGuard = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "IfStatement") &&
  node.alternate === null &&
  isClosestGuard(node.test as EsTreeNode) &&
  isEmptyReturn(node.consequent as EsTreeNode);

const isDomLookupDeclaration = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "VariableDeclaration") || node.declarations.length === 0) return false;
  return node.declarations.every(
    (declaration) =>
      isNodeOfType(declaration.id, "Identifier") &&
      isDomLookupCall(declaration.init as EsTreeNode | null),
  );
};

const isFocusForwardingFunctionBody = (body: EsTreeNode | null | undefined): boolean => {
  if (!body) return false;
  if (isFocusForwardingCall(body)) return true;
  if (!isNodeOfType(body, "BlockStatement") || body.body.length === 0) return false;
  let hasForwardingCall = false;
  for (const statement of body.body) {
    const statementNode = statement as EsTreeNode;
    if (isDomLookupDeclaration(statementNode) || isClosestReturnGuard(statementNode)) continue;
    if (
      isNodeOfType(statementNode, "ExpressionStatement") &&
      isFocusForwardingCall(statementNode.expression as EsTreeNode)
    ) {
      hasForwardingCall = true;
      continue;
    }
    return false;
  }
  return hasForwardingCall;
};

const resolveHandlerFunctionExpression = (
  handlerExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): EsTreeNode | null => {
  const expression = stripParenExpression(handlerExpression);
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const consequent = stripParenExpression(expression.consequent as EsTreeNode);
    const alternate = stripParenExpression(expression.alternate as EsTreeNode);
    if (isNullishExpression(consequent)) {
      return resolveHandlerFunctionExpression(alternate, scopes, visitedSymbolIds);
    }
    if (isNullishExpression(alternate)) {
      return resolveHandlerFunctionExpression(consequent, scopes, visitedSymbolIds);
    }
    return null;
  }
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    if (symbol?.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    return resolveHandlerFunctionExpression(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression") ||
    isNodeOfType(expression, "FunctionDeclaration")
  ) {
    return expression;
  }
  return null;
};

export const isFocusForwardingHandlerExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const handlerFunction = resolveHandlerFunctionExpression(expression, scopes);
  if (!handlerFunction) return false;
  return isFocusForwardingFunctionBody((handlerFunction as { body?: EsTreeNode }).body ?? null);
};

export const isFocusForwardingHandler = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  return isFocusForwardingHandlerExpression(attribute.value.expression as EsTreeNode, scopes);
};
