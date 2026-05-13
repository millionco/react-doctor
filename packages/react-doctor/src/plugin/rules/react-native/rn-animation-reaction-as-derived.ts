import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// HACK: useAnimatedReaction with a body that does nothing but assign to
// another shared value (`sv2.value = current`) is essentially what
// useDerivedValue is for. useDerivedValue is shorter, opts into the
// proper Reanimated dependency tracking, and avoids the side-effect
// gloss that useAnimatedReaction implies (it's meant for cross-thread
// reactions like calling runOnJS, not value derivation).
export const rnAnimationReactionAsDerived = defineRule<Rule>({
  recommendation:
    "Replace useAnimatedReaction with `useDerivedValue(() => ..., [deps])` — shorter, native dependency tracking, no side-effect implication",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "Identifier" || node.callee.name !== "useAnimatedReaction") return;
      const reactionFn = node.arguments?.[1];
      if (!reactionFn) return;
      if (
        reactionFn.type !== "ArrowFunctionExpression" &&
        reactionFn.type !== "FunctionExpression"
      ) {
        return;
      }

      const body = reactionFn.body;

      // We only fire when the reaction body is EXACTLY one statement
      // and that statement is an assignment to another shared value's
      // `.value`. Any additional statement (console.log, function call,
      // condition, runOnJS, etc.) means useAnimatedReaction's
      // side-effect semantics are wanted; useDerivedValue would change
      // behavior.
      let singleAssignment: EsTreeNode | null = null;
      if (body?.type === "BlockStatement") {
        const statements = body.body ?? [];
        if (statements.length !== 1) return;
        const onlyStatement = statements[0];
        if (onlyStatement.type !== "ExpressionStatement") return;
        singleAssignment = onlyStatement.expression;
      } else if (body) {
        // Concise arrow body like `(cur) => sv.value = cur`.
        singleAssignment = body;
      }
      if (!singleAssignment) return;
      if (singleAssignment.type !== "AssignmentExpression") return;
      if (singleAssignment.left?.type !== "MemberExpression") return;
      if (singleAssignment.left.property?.type !== "Identifier") return;
      if (singleAssignment.left.property.name !== "value") return;

      context.report({
        node,
        message:
          "useAnimatedReaction body is a single shared-value assignment — useDerivedValue is shorter and tracks dependencies natively",
      });
    },
  }),
});
