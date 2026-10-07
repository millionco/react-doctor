import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { areNodesOnContradictoryGuardBranches } from "../../utils/are-nodes-on-contradictory-guard-branches.js";
import { areNodesOnExclusiveConditionalBranches } from "../../utils/are-nodes-on-exclusive-conditional-branches.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStaticStringExpression } from "../../utils/get-static-string-expression.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import {
  chainCarriesRejectionHandler,
  isInsideNonRethrowingTry,
} from "../../utils/is-never-rejecting-expression.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { nodesCanCoExecute } from "../../utils/nodes-can-co-execute.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import { resolveStaticJsxAttribute } from "../../utils/resolve-static-jsx-attribute.js";
import type { StaticJsxAttributeResolution } from "../../utils/resolve-static-jsx-attribute.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";

const MESSAGE =
  "This catch replaces a failure with an empty collection, and that same state renders a no-results message, so users see an empty result instead of an error. Preserve an error and retry path instead of writing `[]`.";

const EMPTY_RESULT_CONTAINER_NAMES = new Set([
  "article",
  "aside",
  "div",
  "li",
  "main",
  "p",
  "section",
  "span",
  "td",
]);

const EMPTY_RESULT_TEXT_PATTERN =
  /\b(?:no\s+(?:data|entries|events|files|items?|matches?|messages?|notifications?|orders?|posts?|products?|records?|results?|tasks?|users?)|nothing\s+(?:found|here|to\s+(?:display|show))|(?:collection|inbox|list|results?)\s+is\s+empty)\b/i;

const ERROR_RESULT_TEXT_PATTERN = /\b(?:error(?:ed|s)?|fail(?:ed|ure)?|unable)\b/i;
const HIDDEN_CLASS_NAMES = new Set(["collapse", "hidden", "invisible"]);
const HIDDEN_ARBITRARY_CLASS_TOKEN_PATTERN =
  /^\[(?:display\s*:\s*none|visibility\s*:\s*hidden)\]$/i;

interface EmptyCatchUseStatePair {
  componentFunction: EsTreeNode;
  stateSymbol: SymbolDescriptor;
}

const isEmptyArrayExpression = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  return isNodeOfType(expression, "ArrayExpression") && expression.elements.length === 0;
};

const getSingleReturnedExpression = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(functionNode)) return null;
  const body = functionNode.body;
  if (!isNodeOfType(body, "BlockStatement")) return body;
  if (body.body.length !== 1 || !isNodeOfType(body.body[0], "ReturnStatement")) return null;
  return body.body[0].argument ?? null;
};

const isProvenEmptyArrayValue = (node: EsTreeNode, allowUpdater: boolean): boolean => {
  const expression = stripParenExpression(node);
  if (isEmptyArrayExpression(expression)) return true;
  if (!allowUpdater || !isFunctionLike(expression) || expression.async || expression.generator) {
    return false;
  }
  const returnedExpression = getSingleReturnedExpression(expression);
  return Boolean(returnedExpression && isEmptyArrayExpression(returnedExpression));
};

const isGlobalFetchCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return callee.name === "fetch" && context.scopes.isGlobalReference(callee);
  }
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "fetch") {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    (receiver.name === "globalThis" || receiver.name === "window") &&
    context.scopes.isGlobalReference(receiver)
  );
};

const getPromiseChainRoot = (node: EsTreeNode, boundary: EsTreeNode): EsTreeNode => {
  let chainRoot = findTransparentExpressionRoot(node);
  while (chainRoot !== boundary && chainRoot.parent) {
    const parent = chainRoot.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === chainRoot) {
      chainRoot = parent;
      continue;
    }
    if (isNodeOfType(parent, "CallExpression") && parent.callee === chainRoot) {
      chainRoot = parent;
      continue;
    }
    if (isNodeOfType(parent, "ChainExpression") && parent.expression === chainRoot) {
      chainRoot = parent;
      continue;
    }
    break;
  }
  return chainRoot;
};

const expressionHasEscapingGlobalFetch = (node: EsTreeNode, context: RuleContext): boolean => {
  let didFindEscapingFetch = false;
  walkAst(node, (child) => {
    if (didFindEscapingFetch) return false;
    if (child !== node && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isGlobalFetchCall(child, context) &&
      isNodeReachableWithinFunction(child, context)
    ) {
      const promiseChainRoot = getPromiseChainRoot(child, node);
      if (!chainCarriesRejectionHandler(promiseChainRoot, context.scopes)) {
        didFindEscapingFetch = true;
      }
      return false;
    }
  });
  return didFindEscapingFetch;
};

const localFunctionProducesRequest = (functionNode: EsTreeNode, context: RuleContext): boolean => {
  if (!isFunctionLike(functionNode) || functionNode.generator) return false;
  if (
    isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode.body, "BlockStatement")
  ) {
    return expressionHasEscapingGlobalFetch(functionNode.body, context);
  }
  let hasTryStatement = false;
  let hasRequestEvidence = false;
  walkOwnFunctionScope(functionNode, (child) => {
    if (isNodeOfType(child, "TryStatement")) {
      hasTryStatement = true;
      return false;
    }
    if (!isNodeReachableWithinFunction(child, context)) return false;
    if (
      isNodeOfType(child, "AwaitExpression") &&
      expressionHasEscapingGlobalFetch(child.argument, context)
    ) {
      hasRequestEvidence = true;
      return false;
    }
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      expressionHasEscapingGlobalFetch(child.argument, context)
    ) {
      hasRequestEvidence = true;
      return false;
    }
  });
  return !hasTryStatement && hasRequestEvidence;
};

const isAwaitCaughtBeforeBoundary = (
  awaitExpression: EsTreeNode,
  boundary: EsTreeNode,
): boolean => {
  if (isInsideNonRethrowingTry(awaitExpression, boundary)) return true;
  let child = awaitExpression;
  let ancestor = awaitExpression.parent;
  while (ancestor && ancestor !== boundary) {
    if (isNodeOfType(ancestor, "TryStatement") && ancestor.block === child) {
      if (ancestor.finalizer) return true;
      if (ancestor.handler) {
        const handlerStatements = ancestor.handler.body.body;
        if (
          handlerStatements.length !== 1 ||
          !isNodeOfType(handlerStatements[0], "ThrowStatement")
        ) {
          return true;
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent;
  }
  return false;
};

const hasProvenRequestAwait = (tryBlock: EsTreeNode, context: RuleContext): boolean => {
  let didFindRequestAwait = false;
  walkAst(tryBlock, (child) => {
    if (didFindRequestAwait) return false;
    if (child !== tryBlock && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "AwaitExpression")) return;
    if (!isNodeReachableWithinFunction(child, context)) return false;
    if (isAwaitCaughtBeforeBoundary(child, tryBlock)) return false;
    if (expressionHasEscapingGlobalFetch(child.argument, context)) {
      didFindRequestAwait = true;
      return false;
    }
    const awaitedExpression = stripParenExpression(child.argument);
    if (!isNodeOfType(awaitedExpression, "CallExpression")) return;
    const localFunction = resolveExactLocalFunction(awaitedExpression.callee, context.scopes);
    if (localFunction && localFunctionProducesRequest(localFunction, context)) {
      didFindRequestAwait = true;
      return false;
    }
  });
  return didFindRequestAwait;
};

const getUseStatePairForEmptyCatch = (
  catchClause: EsTreeNodeOfType<"CatchClause">,
  context: RuleContext,
): EmptyCatchUseStatePair | null => {
  const tryStatement = catchClause.parent;
  if (
    !isNodeOfType(tryStatement, "TryStatement") ||
    tryStatement.handler !== catchClause ||
    tryStatement.finalizer ||
    !isNodeReachableWithinFunction(catchClause, context) ||
    !hasProvenRequestAwait(tryStatement.block, context)
  ) {
    return null;
  }
  if (catchClause.body.body.length !== 1) return null;
  const onlyStatement = catchClause.body.body[0];
  if (!isNodeOfType(onlyStatement, "ExpressionStatement")) return null;
  const expression = stripParenExpression(onlyStatement.expression);
  if (
    !isNodeOfType(expression, "CallExpression") ||
    !isNodeOfType(stripParenExpression(expression.callee), "Identifier") ||
    expression.arguments.length !== 1
  ) {
    return null;
  }
  const setterIdentifier = stripParenExpression(expression.callee);
  const nextStateArgument = expression.arguments[0];
  if (
    !isNodeOfType(setterIdentifier, "Identifier") ||
    !nextStateArgument ||
    !isProvenEmptyArrayValue(nextStateArgument, true)
  ) {
    return null;
  }
  const directSetterSymbol = context.scopes.symbolFor(setterIdentifier);
  const statePair = resolveReactUseStatePair(setterIdentifier, context.scopes);
  if (
    !directSetterSymbol ||
    !statePair ||
    directSetterSymbol.id !== statePair.setterSymbol.id ||
    !statePair.stateSymbol
  ) {
    return null;
  }
  const initializer = statePair.declarator.init
    ? stripParenExpression(statePair.declarator.init)
    : null;
  if (
    !initializer ||
    !isNodeOfType(initializer, "CallExpression") ||
    !isReactApiCall(initializer, "useState", context.scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    }) ||
    initializer.arguments.length !== 1 ||
    !isProvenEmptyArrayValue(initializer.arguments[0], true)
  ) {
    return null;
  }
  const componentFunction = findEnclosingFunction(statePair.declarator);
  if (!componentFunction) return null;
  return { componentFunction, stateSymbol: statePair.stateSymbol };
};

const isExactStateLengthRead = (
  node: EsTreeNode,
  stateSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const expression = stripParenExpression(node);
  if (
    !isNodeOfType(expression, "MemberExpression") ||
    getStaticPropertyName(expression) !== "length"
  ) {
    return false;
  }
  const receiver = stripParenExpression(expression.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    context.scopes.symbolFor(receiver)?.id === stateSymbol.id
  );
};

const classifyEmptyResultCondition = (
  node: EsTreeNode,
  stateSymbol: SymbolDescriptor,
  context: RuleContext,
): "empty" | "nonempty" | null => {
  const expression = stripParenExpression(node);
  if (isExactStateLengthRead(expression, stateSymbol, context)) return "nonempty";
  if (
    isNodeOfType(expression, "UnaryExpression") &&
    expression.operator === "!" &&
    isExactStateLengthRead(expression.argument, stateSymbol, context)
  ) {
    return "empty";
  }
  if (!isNodeOfType(expression, "BinaryExpression") || expression.operator !== "===") {
    return null;
  }
  const leftIsZero = isNodeOfType(expression.left, "Literal") && expression.left.value === 0;
  const rightIsZero = isNodeOfType(expression.right, "Literal") && expression.right.value === 0;
  if (leftIsZero && isExactStateLengthRead(expression.right, stateSymbol, context)) return "empty";
  if (rightIsZero && isExactStateLengthRead(expression.left, stateSymbol, context)) return "empty";
  return null;
};

const getStaticClassAttributeValue = (resolution: StaticJsxAttributeResolution): string | null => {
  if (resolution.attribute) return getStringLiteralAttributeValue(resolution.attribute);
  return getStaticStringExpression(resolution.expression);
};

const isOpeningElementProvenVisible = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  if (isHiddenFromScreenReader(openingElement, context.settings)) return false;
  for (const attributeName of ["aria-hidden", "hidden", "style"]) {
    const resolution = resolveStaticJsxAttribute(openingElement.attributes, attributeName, false);
    if (resolution.isPresent || resolution.isUnknown) return false;
  }
  for (const classAttributeName of ["class", "className"]) {
    const classResolution = resolveStaticJsxAttribute(
      openingElement.attributes,
      classAttributeName,
      false,
    );
    if (classResolution.isUnknown) return false;
    if (!classResolution.isPresent) continue;
    const className = getStaticClassAttributeValue(classResolution);
    if (className === null) return false;
    const hasHiddenClass = className.split(/\s+/).some((classToken) => {
      const utility = parseTailwindClassNameToken(classToken).utility;
      return HIDDEN_CLASS_NAMES.has(utility) || HIDDEN_ARBITRARY_CLASS_TOKEN_PATTERN.test(utility);
    });
    if (hasHiddenClass) return false;
  }
  return true;
};

const isStaticIntrinsicJsx = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "JSXElement")) return false;
  if (
    !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
    !EMPTY_RESULT_CONTAINER_NAMES.has(node.openingElement.name.name) ||
    !isOpeningElementProvenVisible(node.openingElement, context)
  ) {
    return false;
  }
  return node.children.every((child) => {
    if (isNodeOfType(child, "JSXText")) return true;
    if (isNodeOfType(child, "JSXElement")) return isStaticIntrinsicJsx(child, context);
    if (!isNodeOfType(child, "JSXExpressionContainer")) return false;
    const childExpression = stripParenExpression(child.expression);
    if (isNodeOfType(childExpression, "JSXEmptyExpression")) return true;
    if (isNodeOfType(childExpression, "Literal")) {
      return typeof childExpression.value === "string";
    }
    return (
      isNodeOfType(childExpression, "TemplateLiteral") && childExpression.expressions.length === 0
    );
  });
};

const isExplicitEmptyResult = (
  node: EsTreeNode | null | undefined,
  context: RuleContext,
): boolean => {
  if (!node) return false;
  const expression = stripParenExpression(node);
  const emptyResultText = getStaticJsxText(expression).replace(/\s+/g, " ").trim();
  return (
    isStaticIntrinsicJsx(expression, context) &&
    EMPTY_RESULT_TEXT_PATTERN.test(emptyResultText) &&
    !ERROR_RESULT_TEXT_PATTERN.test(emptyResultText)
  );
};

const getDirectReturnExpression = (node: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(node, "ReturnStatement")) return node.argument ?? null;
  if (
    isNodeOfType(node, "BlockStatement") &&
    node.body.length === 1 &&
    isNodeOfType(node.body[0], "ReturnStatement")
  ) {
    return node.body[0].argument ?? null;
  }
  return null;
};

const isDirectlyRenderedExpression = (
  node: EsTreeNode,
  componentFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  let expressionRoot = findTransparentExpressionRoot(node);
  while (expressionRoot.parent) {
    const parent = expressionRoot.parent;
    if (
      isNodeOfType(parent, "JSXExpressionContainer") &&
      parent.expression === expressionRoot &&
      !isNodeOfType(parent.parent, "JSXAttribute")
    ) {
      expressionRoot = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXElement")) {
      if (!isOpeningElementProvenVisible(parent.openingElement, context)) return false;
      expressionRoot = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXFragment")) {
      expressionRoot = parent;
      continue;
    }
    break;
  }
  if (isFunctionLike(componentFunction) && componentFunction.body === expressionRoot) return true;
  return Boolean(
    isNodeOfType(expressionRoot.parent, "ReturnStatement") &&
    findEnclosingFunction(expressionRoot.parent) === componentFunction,
  );
};

const routeContainsReachableReturn = (route: EsTreeNode, context: RuleContext): boolean => {
  let didFindReturn = false;
  walkAst(route, (child) => {
    if (didFindReturn) return false;
    if (child !== route && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement") && isNodeReachableWithinFunction(child, context)) {
      didFindReturn = true;
      return false;
    }
  });
  return didFindReturn;
};

const routeCanPreemptEmptyResult = (
  route: EsTreeNodeOfType<"IfStatement"> | EsTreeNodeOfType<"SwitchStatement">,
  emptyResultNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isAstDescendant(emptyResultNode, route)) {
    return routeContainsReachableReturn(route, context);
  }
  if (isNodeOfType(route, "IfStatement")) {
    if (isAstDescendant(emptyResultNode, route.consequent)) {
      return Boolean(route.alternate && routeContainsReachableReturn(route.alternate, context));
    }
    return routeContainsReachableReturn(route.consequent, context);
  }
  return route.cases.some(
    (switchCase) =>
      !isAstDescendant(emptyResultNode, switchCase) &&
      routeContainsReachableReturn(switchCase, context),
  );
};

const hasPriorPreemptingRoute = (
  componentFunction: EsTreeNode,
  emptyResultNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  let didFindPreemptingRoute = false;
  const emptyResultStart = emptyResultNode.range[0];
  walkOwnFunctionScope(componentFunction, (node) => {
    if (didFindPreemptingRoute) return false;
    if (
      (!isNodeOfType(node, "IfStatement") && !isNodeOfType(node, "SwitchStatement")) ||
      node.range[0] >= emptyResultStart ||
      !isNodeReachableWithinFunction(node, context) ||
      !routeCanPreemptEmptyResult(node, emptyResultNode, context)
    ) {
      return;
    }
    didFindPreemptingRoute = true;
  });
  return didFindPreemptingRoute;
};

const hasDirectEmptyResultRender = (
  componentFunction: EsTreeNode,
  stateSymbol: SymbolDescriptor,
  context: RuleContext,
): EsTreeNode | null => {
  let emptyResultNode: EsTreeNode | null = null;
  walkOwnFunctionScope(componentFunction, (node) => {
    if (emptyResultNode) return false;
    if (!isNodeReachableWithinFunction(node, context)) return false;
    if (isNodeOfType(node, "IfStatement")) {
      if (classifyEmptyResultCondition(node.test, stateSymbol, context) !== "empty") return;
      const returnedExpression = getDirectReturnExpression(node.consequent);
      if (isExplicitEmptyResult(returnedExpression, context)) emptyResultNode = node;
      return;
    }
    if (!isNodeOfType(node, "ConditionalExpression")) return;
    const conditionKind = classifyEmptyResultCondition(node.test, stateSymbol, context);
    if (!conditionKind || !isDirectlyRenderedExpression(node, componentFunction, context)) return;
    const emptyBranch = conditionKind === "empty" ? node.consequent : node.alternate;
    if (isExplicitEmptyResult(emptyBranch, context)) emptyResultNode = node;
  });
  return emptyResultNode;
};

export const noCollapseRequestErrorToEmptyState = defineRule({
  id: "no-collapse-request-error-to-empty-state",
  title: "Request failure rendered as an empty result",
  severity: "warn",
  tags: ["react-jsx-only"],
  defaultEnabled: false,
  recommendation:
    "Keep request failure separate from an empty successful response, render an error with a retry action, and leave the previous result visible when appropriate.",
  create: (context: RuleContext) => ({
    CatchClause(node: EsTreeNodeOfType<"CatchClause">) {
      const statePair = getUseStatePairForEmptyCatch(node, context);
      if (!statePair) return;
      const emptyResultNode = hasDirectEmptyResultRender(
        statePair.componentFunction,
        statePair.stateSymbol,
        context,
      );
      if (!emptyResultNode) return;
      if (
        hasPriorPreemptingRoute(statePair.componentFunction, emptyResultNode, context) ||
        !nodesCanCoExecute(node, emptyResultNode, context) ||
        areNodesOnExclusiveConditionalBranches(
          node,
          emptyResultNode,
          statePair.componentFunction,
        ) ||
        areNodesOnContradictoryGuardBranches(node, emptyResultNode, context.scopes)
      ) {
        return;
      }
      context.report({ node: node.body.body[0], message: MESSAGE });
    },
  }),
});
