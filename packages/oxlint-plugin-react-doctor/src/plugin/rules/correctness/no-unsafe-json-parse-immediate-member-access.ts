import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "`JSON.parse` throws `SyntaxError` on malformed input, so reading a property straight off its result crashes with no recovery — wrap it in try/catch or validate the parsed value before you use it.";

// `ParenthesizedExpression` is a real runtime node but is absent from the
// TSESTree type union, so it is matched via a string set.
const GROUPING_EXPRESSION_TYPES = new Set<string>(["ParenthesizedExpression"]);

const isJsonMethodCall = (node: EsTreeNode, method: string): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "JSON" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === method
  );
};

// A `??` / `||` fallback (`JSON.parse(input ?? "{}")`) supplies valid JSON
// when the source is missing, so the parse is guarded by construction.
const hasFallbackArgument = (argument: EsTreeNode): boolean =>
  isNodeOfType(argument, "LogicalExpression") &&
  (argument.operator === "??" || argument.operator === "||");

const isInsideTryBlock = (node: EsTreeNode): boolean => {
  let child: EsTreeNode = node;
  let ancestor: EsTreeNode | null = node.parent ?? null;
  while (ancestor) {
    if (isNodeOfType(ancestor, "TryStatement") && ancestor.block === child)
      return true;
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

export const noUnsafeJsonParseImmediateMemberAccess = defineRule({
  id: "no-unsafe-json-parse-immediate-member-access",
  title: "Immediate member access on JSON.parse result",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "`JSON.parse` throws on malformed input and returns `any`, so wrap it in try/catch (or validate the result) before reading a property instead of accessing `JSON.parse(x).foo` directly.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isJsonMethodCall(node, "parse")) return;
      // A same-file binding named `JSON` shadows the global — bail out.
      const callee = node.callee;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.object, "Identifier")
      ) {
        if (findVariableInitializer(callee.object, "JSON")) return;
      }

      const argument = node.arguments?.[0];
      if (!argument) return;
      const unwrappedArgument = stripParenExpression(argument as EsTreeNode);
      // `JSON.parse(JSON.stringify(x))` is the deep-clone idiom, and the
      // stringify output is always valid JSON.
      if (isJsonMethodCall(unwrappedArgument, "stringify")) return;
      if (hasFallbackArgument(unwrappedArgument)) return;

      // The parse result must be consumed by an immediate property/index
      // access. An intervening `as T` (TSAsExpression) or a validator call
      // sits between the parse and the access as a distinct parent, so those
      // stay quiet; grouping parens are transparent.
      let consumed: EsTreeNode = node;
      let consumer: EsTreeNode | null = node.parent ?? null;
      while (consumer && GROUPING_EXPRESSION_TYPES.has(consumer.type)) {
        consumed = consumer;
        consumer = consumer.parent ?? null;
      }
      if (!consumer) return;
      if (
        !isNodeOfType(consumer, "MemberExpression") ||
        consumer.object !== consumed
      )
        return;

      if (isInsideTryBlock(node)) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
