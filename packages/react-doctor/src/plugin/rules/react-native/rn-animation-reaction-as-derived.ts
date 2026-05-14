import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: useAnimatedReaction with a body that does nothing but assign to
// another shared value (`sv2.value = current`) is essentially what
// useDerivedValue is for. useDerivedValue is shorter, opts into the
// proper Reanimated dependency tracking, and avoids the side-effect
// gloss that useAnimatedReaction implies (it's meant for cross-thread
// reactions like calling runOnJS, not value derivation).
export const rnAnimationReactionAsDerived = defineRule<Rule>({
  requires: ["react-native"],
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    "Replace useAnimatedReaction with `useDerivedValue(() => ..., [deps])` — shorter, native dependency tracking, no side-effect implication",
  examples: [
    {
      before:
        "useAnimatedReaction(\n  () => offset.value,\n  (current) => { progress.value = current / 100; }\n);",
      after: "const progress = useDerivedValue(() => offset.value / 100);",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "useAnimatedReaction")
        return;
      const reactionFn = node.arguments?.[1];
      if (!reactionFn) return;
      if (
        !isNodeOfType(reactionFn, "ArrowFunctionExpression") &&
        !isNodeOfType(reactionFn, "FunctionExpression")
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
      if (isNodeOfType(body, "BlockStatement")) {
        const statements = body.body ?? [];
        if (statements.length !== 1) return;
        const onlyStatement = statements[0];
        if (!isNodeOfType(onlyStatement, "ExpressionStatement")) return;
        singleAssignment = onlyStatement.expression;
      } else if (body) {
        // Concise arrow body like `(cur) => sv.value = cur`.
        singleAssignment = body;
      }
      if (!singleAssignment) return;
      if (!isNodeOfType(singleAssignment, "AssignmentExpression")) return;
      if (!isNodeOfType(singleAssignment.left, "MemberExpression")) return;
      if (!isNodeOfType(singleAssignment.left.property, "Identifier")) return;
      if (singleAssignment.left.property.name !== "value") return;

      context.report({
        node,
        message:
          "useAnimatedReaction body is a single shared-value assignment — useDerivedValue is shorter and tracks dependencies natively",
      });
    },
  }),
});
