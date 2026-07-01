import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.";

const FIND_METHOD_NAMES = new Set(["find", "findLast"]);
// A PascalCase identifier names a class / model / component, never array data.
// It rules out `User.find(...)` (an ORM static) as a RECEIVER and
// `wrapper.find(Component)` (an enzyme/RTL component-selector query) as the
// ARGUMENT — neither result is an array element that can be `undefined`.
const PASCAL_CASE_IDENTIFIER_PATTERN = /^[A-Z]/;
// `ParenthesizedExpression` is a real runtime node but is absent from the
// TSESTree type union, so it is matched via a string set rather than
// `isNodeOfType`.
const GROUPING_EXPRESSION_TYPES = new Set<string>(["ParenthesizedExpression"]);

// A callback-shaped first argument distinguishes `Array.prototype.find` from
// ORM query builders like `Model.find({ where: ... })` (an ObjectExpression
// argument, a hydrated row result) and from enzyme/RTL `wrapper.find(Component)`
// component-selector queries (a PascalCase identifier argument, a wrapper
// result), whose `.instance()`/`.first()`/`.props()` chains must stay quiet.
const hasArrayCallbackFirstArgument = (
  node: EsTreeNodeOfType<"CallExpression">
): boolean => {
  const firstArgument = node.arguments?.[0];
  if (!firstArgument) return false;
  if (
    isNodeOfType(firstArgument, "ArrowFunctionExpression") ||
    isNodeOfType(firstArgument, "FunctionExpression")
  ) {
    return true;
  }
  // A bare identifier is a predicate reference (`items.find(isActive)`), unless
  // it is PascalCase — a component selector (`wrapper.find(Modal)`), not a
  // predicate.
  return (
    isNodeOfType(firstArgument, "Identifier") &&
    !PASCAL_CASE_IDENTIFIER_PATTERN.test(firstArgument.name)
  );
};

const isArrayFindCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed)
    return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (!FIND_METHOD_NAMES.has(callee.property.name)) return false;
  // `User.find(...)` / `Model.find(...)`: a capitalized receiver is a
  // class/model static method, not an array instance method.
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  if (
    isNodeOfType(receiver, "Identifier") &&
    PASCAL_CASE_IDENTIFIER_PATTERN.test(receiver.name)
  ) {
    return false;
  }
  return hasArrayCallbackFirstArgument(node);
};

export const noArrayFindResultMemberAccessWithoutGuard = defineRule({
  id: "no-array-find-result-member-access-without-guard",
  title: "Unguarded member access on find() result",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "`Array.prototype.find`/`findLast` return `undefined` when no element matches, so guard the result with optional chaining (`?.`) or a null check before reading a property, indexing, or calling it.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isArrayFindCall(node)) return;

      let consumed: EsTreeNode = node;
      let consumer: EsTreeNode | null = node.parent ?? null;
      while (consumer && GROUPING_EXPRESSION_TYPES.has(consumer.type)) {
        consumed = consumer;
        consumer = consumer.parent ?? null;
      }
      if (!consumer) return;

      // An intervening `!` token (TSNonNullExpression) hands the finding to
      // the existing no-non-null-assertion rule, so only a bare, non-optional
      // property read/index/call on the result is reported here.
      if (isNodeOfType(consumer, "MemberExpression")) {
        if (consumer.object === consumed && !consumer.optional) {
          context.report({ node, message: MESSAGE });
        }
        return;
      }
      if (isNodeOfType(consumer, "CallExpression")) {
        if (consumer.callee === consumed && !consumer.optional) {
          context.report({ node, message: MESSAGE });
        }
      }
    },
  }),
});
