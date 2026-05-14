import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isSimpleExpression } from "../../utils/is-simple-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Identifiers and member-access chains are technically "simple", but memoizing
// them is sometimes intentional (stable reference passing). Only flag arithmetic
// / literal trivial cases to keep false positives low.
const isTriviallyCheapExpression = (node: EsTreeNode | null): boolean => {
  if (!node) return false;
  if (!isSimpleExpression(node)) return false;
  if (isNodeOfType(node, "Identifier")) return false;
  if (isNodeOfType(node, "MemberExpression")) return false;
  return true;
};

export const noUsememoSimpleExpression = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Remove useMemo — property access, math, and ternaries are already cheap without memoization",
  examples: [
    {
      before: "const doubled = useMemo(() => count * 2, [count]);",
      after: "const doubled = count * 2;",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, "useMemo")) return;

      const callback = node.arguments?.[0];
      if (!callback) return;
      if (
        !isNodeOfType(callback, "ArrowFunctionExpression") &&
        !isNodeOfType(callback, "FunctionExpression")
      )
        return;

      let returnExpression = null;
      if (!isNodeOfType(callback.body, "BlockStatement")) {
        returnExpression = callback.body;
      } else if (
        callback.body.body?.length === 1 &&
        isNodeOfType(callback.body.body[0], "ReturnStatement")
      ) {
        returnExpression = callback.body.body[0].argument;
      }

      if (returnExpression && isTriviallyCheapExpression(returnExpression)) {
        context.report({
          node,
          message:
            "useMemo wrapping a trivially cheap expression — memo overhead exceeds the computation",
        });
      }
    },
  }),
});
