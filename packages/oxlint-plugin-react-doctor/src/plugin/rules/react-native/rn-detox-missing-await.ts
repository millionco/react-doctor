import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
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

// Terminal `.then`/`.catch`/`.finally` means the promise is already being
// handled — not a missing await.
const PROMISE_SETTLE_METHODS = new Set<string>(["then", "catch", "finally"]);

interface ChainRoot {
  readonly calleeName: string;
  readonly rootCall: EsTreeNodeOfType<"CallExpression">;
}

// Walks down the `.callee.object` chain of a call/member expression to the
// innermost call whose callee is a bare identifier (`element(...)`,
// `waitFor(...)`, `expect(...)`), returning that identifier name.
const findChainRoot = (node: EsTreeNode): ChainRoot | null => {
  if (isNodeOfType(node, "CallExpression")) {
    if (isNodeOfType(node.callee, "Identifier")) {
      return { calleeName: node.callee.name, rootCall: node };
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
const isDetoxExpectSubject = (rootCall: EsTreeNodeOfType<"CallExpression">): boolean => {
  const firstArgument = rootCall.arguments?.[0];
  if (!firstArgument || !isNodeOfType(firstArgument, "CallExpression")) return false;
  if (!isNodeOfType(firstArgument.callee, "Identifier")) return false;
  return firstArgument.callee.name === "element" || firstArgument.callee.name === "web";
};

const getTerminalMethodName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const callee = callExpression.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  if (callee.computed || !isNodeOfType(callee.property, "Identifier")) return null;
  return callee.property.name;
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
export const rnDetoxMissingAwait = defineRule<Rule>({
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
        const expression = node.expression;
        // Awaited / yielded calls aren't `CallExpression` here.
        if (!isNodeOfType(expression, "CallExpression")) return;
        const terminalMethod = getTerminalMethodName(expression);
        // A bare `element(by.id('x'))` (callee is the `element` identifier,
        // no terminal method) only builds a matcher — nothing to await.
        if (terminalMethod === null) return;
        if (PROMISE_SETTLE_METHODS.has(terminalMethod)) return;

        const root = findChainRoot(expression);
        if (!root) return;

        if (root.calleeName === "element") {
          if (!DETOX_ELEMENT_ACTIONS.has(terminalMethod)) return;
          context.report({
            node,
            message: `This Detox action (\`${terminalMethod}\`) isn't awaited, so it runs out of order and can race. Prepend \`await\`.`,
          });
          return;
        }

        if (root.calleeName === "waitFor") {
          context.report({
            node,
            message: "This Detox `waitFor(...)` chain isn't awaited. Prepend `await`.",
          });
          return;
        }

        if (root.calleeName === "expect" && isDetoxExpectSubject(root.rootCall)) {
          context.report({
            node,
            message: "This Detox `expect(element(...))` assertion isn't awaited. Prepend `await`.",
          });
        }
      },
    };
  },
});
