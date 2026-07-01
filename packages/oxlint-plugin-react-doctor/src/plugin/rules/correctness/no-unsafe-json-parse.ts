import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isObjectOfMemberAccess } from "../../utils/is-object-of-member-access.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "Reading a property straight off `JSON.parse(...)` is a double crash: `JSON.parse` throws `SyntaxError` on malformed or empty input, and its `any` result lets an undefined property pass the type-checker and throw at runtime; wrap the parse in try/catch and validate the result before accessing fields.";

// `JSON.<method>(...)` with a non-computed `JSON` member callee. Computed
// access (`JSON["parse"]`) is a v1 non-goal (vanishingly rare).
const isJsonMethodCall = (node: EsTreeNode, method: string): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.computed &&
  isNodeOfType(node.callee.object, "Identifier") &&
  node.callee.object.name === "JSON" &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === method;

// oxc surfaces redundant parens as a `ParenthesizedExpression` wrapper,
// which TSESTree's node-type union doesn't model — compare `type` as a
// plain string to walk past it.
const PARENTHESIZED_EXPRESSION_TYPE: string = "ParenthesizedExpression";

// A `??` / `||` fallback (`JSON.parse(input ?? "{}")`) supplies valid JSON when
// the source is missing, so the parse is guarded by construction.
const hasFallbackArgument = (argument: EsTreeNode): boolean =>
  isNodeOfType(argument, "LogicalExpression") &&
  (argument.operator === "??" || argument.operator === "||");

// True when a property is read directly off the call result:
// `JSON.parse(x).foo`, tolerating `(JSON.parse(x)).foo` parens. A `TSAsExpression`
// / `TSSatisfiesExpression` parent means the author annotated the result and
// is intentionally out of scope, so it is NOT treated as an unsafe deref.
const isImmediatelyMemberAccessed = (call: EsTreeNode): boolean => {
  let current = call;
  while (current.parent && current.parent.type === PARENTHESIZED_EXPRESSION_TYPE) {
    current = current.parent;
  }
  return isObjectOfMemberAccess(current);
};

export const noUnsafeJsonParse = defineRule({
  id: "no-unsafe-json-parse",
  title: "Unsafe JSON.parse dereference",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "Wrap `JSON.parse(x)` in try/catch and validate the result (for example with a schema) before reading properties off it. A bare `JSON.parse(x).foo` throws on bad input and lets undefined fields slip past the type-checker.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isJsonMethodCall(node as EsTreeNode, "parse")) return;
      // A same-file binding named `JSON` shadows the global — bail out.
      const callee = node.callee;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.object, "Identifier") &&
        findVariableInitializer(callee.object, "JSON")
      )
        return;
      const firstArgument = node.arguments?.[0];
      if (firstArgument) {
        const unwrappedArgument = stripParenExpression(firstArgument);
        // `JSON.parse(JSON.stringify(x))` is the deep-clone idiom; stringify
        // output is always valid JSON.
        if (isJsonMethodCall(unwrappedArgument, "stringify")) return;
        if (hasFallbackArgument(unwrappedArgument)) return;
      }
      if (!isImmediatelyMemberAccessed(node as EsTreeNode)) return;
      if (isInsideTryStatement(node as EsTreeNode, { region: "block" })) return;
      context.report({ node, message: MESSAGE });
    },
  }),
});
