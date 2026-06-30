import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Only a `new RegExp(...)` whose pattern is a compile-time-constant
// string is genuinely loop-invariant and worth hoisting. When the
// pattern is a binding (`new RegExp(keyword, "gi")`) it depends on the
// loop variable, so each pass builds a different regex and hoisting is
// impossible — flagging it would be a false positive.
const isStaticPattern = (argument: EsTreeNode | null | undefined): boolean => {
  if (!argument) return false;
  if (isNodeOfType(argument, "Literal")) return true;
  return isNodeOfType(argument, "TemplateLiteral") && (argument.expressions?.length ?? 0) === 0;
};

export const jsHoistRegexp = defineRule({
  id: "js-hoist-regexp",
  title: "RegExp built inside a loop",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move `new RegExp(...)` (or large regex literals) to a constant outside the loop so it isn't rebuilt on every pass",
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name === "RegExp" &&
          isStaticPattern(node.arguments?.[0] as EsTreeNode | undefined)
        ) {
          context.report({
            node,
            message:
              "`new RegExp()` rebuilds the pattern on every loop pass. Move it to a constant outside the loop.",
          });
        }
      },
    }),
});
