import { PROMISE_SETTLE_METHODS } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

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
  "pinch",
  "setColumnToValue",
  "setDatePickerDate",
  "performAccessibilityAction",
  "adjustSliderToPosition",
]);

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

const isCallableHandler = (argument: EsTreeNode | undefined): boolean => {
  if (!argument) return false;
  const candidate = stripParenExpression(argument);
  return (
    isNodeOfType(candidate, "ArrowFunctionExpression") ||
    isNodeOfType(candidate, "FunctionExpression") ||
    isNodeOfType(candidate, "Identifier") ||
    isNodeOfType(candidate, "MemberExpression")
  );
};

const getDetoxOperationMethodName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  let currentCall = callExpression;
  while (true) {
    const methodName = getTerminalMethodName(currentCall);
    if (methodName === null) return null;
    if (!PROMISE_SETTLE_METHODS.has(methodName)) return methodName;
    if (methodName === "catch") {
      if (isCallableHandler(currentCall.arguments[0] as EsTreeNode | undefined)) return null;
    } else if (methodName === "then") {
      if (isCallableHandler(currentCall.arguments[1] as EsTreeNode | undefined)) return null;
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
        const terminalMethod = getDetoxOperationMethodName(expression);
        // A bare `element(by.id('x'))` (callee is the `element` identifier,
        // no terminal method) only builds a matcher — nothing to await.
        if (terminalMethod === null) return;
        const root = findChainRoot(expression);
        if (!root) return;
        const rootName = canonicalDetoxRootName(root, context);
        if (!rootName) return;

        if (rootName === "element") {
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
