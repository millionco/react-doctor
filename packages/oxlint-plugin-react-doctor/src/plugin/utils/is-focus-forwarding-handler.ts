import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNullishExpression } from "./is-nullish-expression.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// `.click()` is excluded because forwarding activation to a hidden control
// leaves that action unreachable to keyboard users.
const FOCUS_FORWARDING_METHOD_NAMES: ReadonlySet<string> = new Set(["focus", "select"]);
const EVENT_BLOCKER_METHOD_NAMES: ReadonlySet<string> = new Set([
  "stopPropagation",
  "preventDefault",
  "stopImmediatePropagation",
]);

const DOM_LOOKUP_METHOD_NAMES: ReadonlySet<string> = new Set(["getElementById", "querySelector"]);
const GLOBAL_OBJECT_NAMES: ReadonlySet<string> = new Set(["global", "globalThis", "window"]);

const getCalledMethodName = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  const expression = isNodeOfType(node, "ChainExpression") ? (node.expression as EsTreeNode) : node;
  if (!isNodeOfType(expression, "CallExpression")) return null;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const property = callee.property as EsTreeNode;
  return isNodeOfType(property, "Identifier") ? property.name : null;
};

const isAllowedFocusForwardingCall = (
  node: EsTreeNode | null | undefined,
  shouldAllowEventBlocker: boolean,
): boolean => {
  const methodName = getCalledMethodName(node);
  return (
    methodName !== null &&
    (FOCUS_FORWARDING_METHOD_NAMES.has(methodName) ||
      (shouldAllowEventBlocker && EVENT_BLOCKER_METHOD_NAMES.has(methodName)))
  );
};

const isGlobalDocumentExpression = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    return candidate.name === "document" && scopes.isGlobalReference(candidate);
  }
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    !isNodeOfType(candidate.object, "Identifier") ||
    !isNodeOfType(candidate.property, "Identifier") ||
    candidate.property.name !== "document"
  ) {
    return false;
  }
  return (
    GLOBAL_OBJECT_NAMES.has(candidate.object.name) && scopes.isGlobalReference(candidate.object)
  );
};

const isStaticSelectorExpression = (expression: EsTreeNode): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier") || isNodeOfType(candidate, "Literal")) return true;
  return (
    isNodeOfType(candidate, "TemplateLiteral") &&
    candidate.expressions.every((innerExpression) =>
      isStaticSelectorExpression(innerExpression as EsTreeNode),
    )
  );
};

const getDomLookupVariableName = (statement: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.kind !== "const" ||
    statement.declarations.length !== 1
  ) {
    return null;
  }
  const declaration = statement.declarations[0];
  if (!declaration || !isNodeOfType(declaration.id, "Identifier") || !declaration.init) return null;
  const initializer = stripParenExpression(declaration.init);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.arguments.length !== 1 ||
    isNodeOfType(initializer.arguments[0], "SpreadElement") ||
    !isStaticSelectorExpression(initializer.arguments[0] as EsTreeNode)
  ) {
    return null;
  }
  const callee = stripParenExpression(initializer.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !isNodeOfType(callee.property, "Identifier") ||
    !DOM_LOOKUP_METHOD_NAMES.has(callee.property.name) ||
    !isGlobalDocumentExpression(callee.object as EsTreeNode, scopes)
  ) {
    return null;
  }
  return declaration.id.name;
};

const isEmptyReturn = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "ReturnStatement")) return node.argument === null;
  if (!isNodeOfType(node, "BlockStatement") || node.body.length !== 1) return false;
  return isEmptyReturn(node.body[0] as EsTreeNode);
};

const isEventTargetClosestReturnGuard = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "IfStatement") || node.alternate || !isEmptyReturn(node.consequent)) {
    return false;
  }
  const test = stripParenExpression(node.test);
  const call = isNodeOfType(test, "ChainExpression") ? test.expression : test;
  if (!isNodeOfType(call, "CallExpression") || call.arguments.length !== 1) return false;
  const callee = stripParenExpression(call.callee);
  const receiver = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object as EsTreeNode)
    : null;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "closest" &&
    isNodeOfType(receiver, "MemberExpression") &&
    isNodeOfType(receiver.object, "Identifier") &&
    isNodeOfType(receiver.property, "Identifier") &&
    receiver.property.name === "target" &&
    isNodeOfType(call.arguments[0], "Literal") &&
    typeof call.arguments[0].value === "string"
  );
};

const isFocusCallOnVariable = (statement: EsTreeNode, variableName: string): boolean => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const expression = stripParenExpression(statement.expression);
  if (!isNodeOfType(expression, "CallExpression") || expression.arguments.length !== 0)
    return false;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === variableName &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "focus"
  );
};

const isAllowedFocusForwardingFunctionBody = (
  body: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
  shouldAllowEventBlocker: boolean,
): boolean => {
  if (!body) return false;
  if (isAllowedFocusForwardingCall(body, shouldAllowEventBlocker)) return true;
  if (!isNodeOfType(body, "BlockStatement") || body.body.length === 0) return false;
  const statements = body.body as EsTreeNode[];
  const firstActionIndex = isEventTargetClosestReturnGuard(statements[0] as EsTreeNode) ? 1 : 0;
  const domLookupStatement = statements[firstActionIndex];
  const domLookupVariableName = domLookupStatement
    ? getDomLookupVariableName(domLookupStatement, scopes)
    : null;
  if (domLookupVariableName) {
    return (
      statements.length === firstActionIndex + 2 &&
      isFocusCallOnVariable(statements[firstActionIndex + 1] as EsTreeNode, domLookupVariableName)
    );
  }
  if (firstActionIndex > 0) return false;
  return statements.every(
    (statement) =>
      isNodeOfType(statement, "ExpressionStatement") &&
      isAllowedFocusForwardingCall(statement.expression as EsTreeNode, shouldAllowEventBlocker),
  );
};

const isGlobalNullishExpression = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNullishExpression(expression) &&
  (!isNodeOfType(expression, "Identifier") || scopes.isGlobalReference(expression));

interface ResolvedHandlerFunction {
  handlerFunction: EsTreeNode;
  isConditional: boolean;
}

const resolveHandlerFunctionExpression = (
  handlerExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): ResolvedHandlerFunction | null => {
  const expression = stripParenExpression(handlerExpression);
  if (isNodeOfType(expression, "ConditionalExpression")) {
    const consequent = stripParenExpression(expression.consequent as EsTreeNode);
    const alternate = stripParenExpression(expression.alternate as EsTreeNode);
    let resolvedHandler: ResolvedHandlerFunction | null = null;
    if (isGlobalNullishExpression(consequent, scopes)) {
      resolvedHandler = resolveHandlerFunctionExpression(alternate, scopes, visitedSymbolIds);
    }
    if (isGlobalNullishExpression(alternate, scopes)) {
      resolvedHandler = resolveHandlerFunctionExpression(consequent, scopes, visitedSymbolIds);
    }
    return resolvedHandler ? { ...resolvedHandler, isConditional: true } : null;
  }
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    if (
      !symbol?.initializer ||
      !["const", "let", "function"].includes(symbol.kind) ||
      symbol.references.some((reference) => reference.flag !== "read") ||
      visitedSymbolIds.has(symbol.id)
    ) {
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
    return { handlerFunction: expression, isConditional: false };
  }
  return null;
};

export const isFocusForwardingOrBlockingHandlerExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const resolvedHandler = resolveHandlerFunctionExpression(expression, scopes);
  if (!resolvedHandler) return false;
  return isAllowedFocusForwardingFunctionBody(
    (resolvedHandler.handlerFunction as { body?: EsTreeNode }).body ?? null,
    scopes,
    !resolvedHandler.isConditional,
  );
};

export const isFocusForwardingOrBlockingHandler = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!attribute.value || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  return isFocusForwardingOrBlockingHandlerExpression(
    attribute.value.expression as EsTreeNode,
    scopes,
  );
};
