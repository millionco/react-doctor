import { PROMISE_SETTLE_METHODS } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const EMPTY_VISITORS: RuleVisitors = {};

// Only run in Detox test files. `.e2e.<ext>` is the Detox convention and
// an `e2e/` directory is the other common layout. Gating here (plus the
// Detox-specific call shape below) keeps the rule off app source and off
// backend `*.e2e.test.ts` files (which never call `element(by.…)`).
const DETOX_TEST_FILE = /(\.e2e\.[cm]?[jt]sx?$)|((^|\/)e2e\/)/;

// Detox element actions — calling one returns a promise tied to Detox's
// synchronization. The matcher-only methods (`atIndex`, `withAncestor`,
// …) are intentionally NOT here: `element(by.id('x')).atIndex(0)` as a
// bare statement just narrows a matcher, it performs nothing.
const DETOX_ELEMENT_ACTIONS = new Set<string>([
  "tap",
  "multiTap",
  "longPress",
  "longPressAndDrag",
  "swipe",
  "scroll",
  "scrollTo",
  "scrollToIndex",
  "scrollToElement",
  "typeText",
  "replaceText",
  "clearText",
  "tapReturnKey",
  "tapBackspaceKey",
  "tapAtPoint",
  "pinch",
  "pinchWithAngle",
  "setColumnToValue",
  "setDatePickerDate",
  "performAccessibilityAction",
  "adjustSliderToPosition",
  "getAttributes",
  "takeScreenshot",
]);

const TEST_CALL_NAMES = new Set(["it", "specify", "test"]);

interface ChainRoot {
  readonly calleeName: string;
  readonly callee: EsTreeNodeOfType<"Identifier">;
  readonly rootCall: EsTreeNodeOfType<"CallExpression">;
}

// Walks down the `.callee.object` chain of a call/member expression to the
// innermost call whose callee is a bare identifier (`element(...)`,
// `waitFor(...)`, `expect(...)`), returning that identifier name.
const findChainRoot = (wrappedNode: EsTreeNode): ChainRoot | null => {
  const node = stripParenExpression(wrappedNode);
  if (isNodeOfType(node, "CallExpression")) {
    if (isNodeOfType(node.callee, "Identifier")) {
      return { calleeName: node.callee.name, callee: node.callee, rootCall: node };
    }
    if (isNodeOfType(node.callee, "MemberExpression")) {
      const receiver = stripParenExpression(node.callee.object);
      if (
        isNodeOfType(receiver, "Identifier") &&
        getStaticPropertyName(node.callee) === "element"
      ) {
        return { calleeName: receiver.name, callee: receiver, rootCall: node };
      }
      return findChainRoot(node.callee.object);
    }
    return null;
  }
  if (isNodeOfType(node, "MemberExpression")) return findChainRoot(node.object);
  return null;
};

// `expect(element(...))` / `expect(web(...))` is Detox; `expect(value)` is
// Jest. We only treat the call as Detox when the first argument is itself
// an `element(...)` / `web(...)` call.
const isDetoxExpectSubject = (
  rootCall: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const firstArgument = rootCall.arguments?.[0];
  if (!firstArgument || !isNodeOfType(firstArgument, "CallExpression")) return false;
  const subjectRoot = findChainRoot(firstArgument);
  if (!subjectRoot) return false;
  const subjectName = canonicalDetoxRootName(subjectRoot, context);
  return subjectName === "element" || subjectName === "web";
};

const canonicalDetoxRootName = (root: ChainRoot, context: RuleContext): string | null => {
  const importSource = getImportSourceForName(root.rootCall, root.calleeName);
  if (importSource === "detox") {
    const declaration = context.scopes.symbolFor(root.callee)?.declarationNode;
    if (
      declaration &&
      isNodeOfType(declaration, "ImportSpecifier") &&
      isNodeOfType(declaration.imported, "Identifier")
    ) {
      return declaration.imported.name;
    }
    return root.calleeName;
  }
  return context.scopes.isGlobalReference(root.callee) ? root.calleeName : null;
};

const getTerminalMethodName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const callee = callExpression.callee;
  return isNodeOfType(callee, "MemberExpression") ? getStaticPropertyName(callee) : null;
};

const isCallableHandler = (
  argument: EsTreeNode | undefined,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  if (!argument) return false;
  const candidate = stripParenExpression(argument);
  if (isFunctionLike(candidate) || isNodeOfType(candidate, "MemberExpression")) return true;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  if (candidate.name === "undefined" && context.scopes.isGlobalReference(candidate)) return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (!symbol) return context.scopes.isGlobalReference(candidate);
  if (visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  if (symbol.kind === "function" || symbol.kind === "import" || symbol.kind === "parameter") {
    return true;
  }
  return symbol.initializer
    ? isCallableHandler(symbol.initializer, context, visitedSymbolIds)
    : false;
};

const testCallName = (callee: EsTreeNode): string | null => {
  const expression = stripParenExpression(callee);
  if (isNodeOfType(expression, "Identifier")) return expression.name;
  if (!isNodeOfType(expression, "MemberExpression")) return null;
  const receiver = stripParenExpression(expression.object as EsTreeNode);
  return isNodeOfType(receiver, "Identifier") ? receiver.name : null;
};

const isParameterizedTestCall = (callee: EsTreeNode): boolean => {
  const expression = stripParenExpression(callee);
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const eachMember = stripParenExpression(expression.callee);
  if (
    !isNodeOfType(eachMember, "MemberExpression") ||
    getStaticPropertyName(eachMember) !== "each"
  ) {
    return false;
  }
  const receiver = stripParenExpression(eachMember.object);
  return isNodeOfType(receiver, "Identifier") && TEST_CALL_NAMES.has(receiver.name);
};

const isCallToBinding = (
  expression: EsTreeNode,
  bindingIdentifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression")) return false;
  const callee = stripParenExpression(call.callee);
  return (
    isNodeOfType(callee, "Identifier") &&
    context.scopes.symbolFor(callee)?.bindingIdentifier === bindingIdentifier
  );
};

const handlerSchedulesDone = (
  handlerNode: EsTreeNode,
  bindingIdentifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  const handler = stripParenExpression(handlerNode);
  if (!isFunctionLike(handler)) return false;
  let completionExpression: EsTreeNode | null = null;
  if (isNodeOfType(handler.body, "BlockStatement")) {
    const onlyStatement = handler.body.body.length === 1 ? handler.body.body[0] : null;
    if (isNodeOfType(onlyStatement, "ExpressionStatement")) {
      completionExpression = onlyStatement.expression;
    } else if (isNodeOfType(onlyStatement, "ReturnStatement")) {
      completionExpression = onlyStatement.argument;
    }
  } else {
    completionExpression = handler.body;
  }
  if (!completionExpression) return false;
  if (isCallToBinding(completionExpression, bindingIdentifier, context)) return true;
  const timerCall = stripParenExpression(completionExpression);
  if (!isNodeOfType(timerCall, "CallExpression")) return false;
  const timerCallee = stripParenExpression(timerCall.callee);
  if (
    !isNodeOfType(timerCallee, "Identifier") ||
    timerCallee.name !== "setTimeout" ||
    !context.scopes.isGlobalReference(timerCallee)
  ) {
    return false;
  }
  const timerHandler = timerCall.arguments[0];
  if (!timerHandler || isNodeOfType(timerHandler, "SpreadElement")) return false;
  const unwrappedTimerHandler = stripParenExpression(timerHandler);
  if (
    isNodeOfType(unwrappedTimerHandler, "Identifier") &&
    context.scopes.symbolFor(unwrappedTimerHandler)?.bindingIdentifier === bindingIdentifier
  ) {
    return true;
  }
  return handlerSchedulesDone(timerHandler, bindingIdentifier, context);
};

const isCompletedByDoneCallback = (
  chainExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const testCallback = findEnclosingFunction(chainExpression);
  if (!testCallback || !isFunctionLike(testCallback)) return false;
  const callbackRoot = findTransparentExpressionRoot(testCallback);
  const testCall = callbackRoot.parent;
  if (
    !isNodeOfType(testCall, "CallExpression") ||
    !testCall.arguments.some((argument) => argument === callbackRoot) ||
    (!TEST_CALL_NAMES.has(testCallName(testCall.callee as EsTreeNode) ?? "") &&
      !isParameterizedTestCall(testCall.callee as EsTreeNode))
  ) {
    return false;
  }
  const isParameterized = isParameterizedTestCall(testCall.callee as EsTreeNode);
  if ((!isParameterized && testCallback.params.length !== 1) || testCallback.params.length === 0) {
    return false;
  }
  const doneParameter = testCallback.params.at(-1);
  if (!doneParameter || !isNodeOfType(doneParameter, "Identifier")) return false;
  const doneBindingIdentifier = context.scopes.symbolFor(doneParameter)?.bindingIdentifier;
  if (!doneBindingIdentifier) return false;

  if (getTerminalMethodName(chainExpression) !== "then") return false;
  const fulfillmentHandler = chainExpression.arguments[0] as EsTreeNode | undefined;
  if (!fulfillmentHandler) return false;
  const handler = stripParenExpression(fulfillmentHandler);
  const handlerBindingIdentifier = isNodeOfType(handler, "Identifier")
    ? context.scopes.symbolFor(handler)?.bindingIdentifier
    : null;
  if (handlerBindingIdentifier === doneBindingIdentifier) {
    return true;
  }
  return handlerSchedulesDone(handler, doneBindingIdentifier, context);
};

const getDetoxOperationMethodName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): string | null => {
  let currentCall = callExpression;
  while (true) {
    const methodName = getTerminalMethodName(currentCall);
    if (methodName === null) return null;
    if (!PROMISE_SETTLE_METHODS.has(methodName)) return methodName;
    if (methodName === "catch") {
      if (isCallableHandler(currentCall.arguments[0] as EsTreeNode | undefined, context))
        return null;
    } else if (methodName === "then") {
      if (isCallableHandler(currentCall.arguments[1] as EsTreeNode | undefined, context))
        return null;
    }
    const callee = currentCall.callee;
    if (!isNodeOfType(callee, "MemberExpression")) return null;
    const receiver = stripParenExpression(callee.object);
    if (!isNodeOfType(receiver, "CallExpression")) return null;
    currentCall = receiver;
  }
};

// HACK: Detox actions, `waitFor(...).…withTimeout()`, and
// `expect(element(...)).<matcher>()` all return promises wired into
// Detox's synchronization. A bare (un-awaited) statement runs out of
// order and can race / leak unhandled rejections — every Detox doc example
// awaits them. We only inspect `ExpressionStatement` expressions, so an
// awaited call (`await …`, whose statement expression is an
// `AwaitExpression`), a `return`ed call, an assignment, or an
// `element(...)` passed as a multiline ARGUMENT to another call are all
// naturally excluded — the corpus showed those argument lines are the main
// false-positive trap for a text-based detector.
export const rnDetoxMissingAwait = defineRule({
  id: "rn-detox-missing-await",
  title: "Un-awaited Detox action",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Prepend `await` to Detox actions, `waitFor(...)` chains, and `expect(element(...))` assertions. They return promises tied to Detox's synchronization, so a missing await runs steps out of order.",
  create: (context: RuleContext) => {
    const filename = normalizeFilename(context.filename ?? "");
    if (!filename || !DETOX_TEST_FILE.test(filename)) return EMPTY_VISITORS;

    return {
      ExpressionStatement(node: EsTreeNodeOfType<"ExpressionStatement">) {
        const expression =
          isNodeOfType(node.expression, "UnaryExpression") && node.expression.operator === "void"
            ? stripParenExpression(node.expression.argument)
            : node.expression;
        if (!isNodeOfType(expression, "CallExpression")) return;
        if (isCompletedByDoneCallback(expression, context)) return;
        const terminalMethod = getDetoxOperationMethodName(expression, context);
        // A bare `element(by.id('x'))` (callee is the `element` identifier,
        // no terminal method) only builds a matcher — nothing to await.
        if (terminalMethod === null) return;
        const root = findChainRoot(expression);
        if (!root) return;
        const rootName = canonicalDetoxRootName(root, context);
        if (!rootName) return;

        if (rootName === "element" || rootName === "web") {
          if (!DETOX_ELEMENT_ACTIONS.has(terminalMethod)) return;
          context.report({
            node,
            message: `This Detox action (\`${terminalMethod}\`) isn't awaited, so it runs out of order and can race. Prepend \`await\`.`,
          });
          return;
        }

        if (rootName === "waitFor") {
          context.report({
            node,
            message:
              "This Detox `waitFor` chain isn't awaited, so the test can continue before the condition settles. Prepend `await`.",
          });
          return;
        }

        if (rootName === "expect" && isDetoxExpectSubject(root.rootCall, context)) {
          context.report({
            node,
            message:
              "This Detox `expect(element)` assertion isn't awaited, so the test can pass or fail before the assertion settles. Prepend `await`.",
          });
        }
      },
    };
  },
});
