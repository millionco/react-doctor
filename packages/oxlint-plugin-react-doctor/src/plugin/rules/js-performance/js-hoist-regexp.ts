import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Only a `new RegExp(...)` whose pattern AND flags are compile-time-constant
// strings is genuinely loop-invariant and worth hoisting. When either
// argument is a binding (`new RegExp(keyword, "gi")`, `new RegExp("token",
// flags)`) it depends on the loop variable, so each pass builds a different
// regex and hoisting is impossible — flagging it would be a false positive.
const isStaticPattern = (argument: EsTreeNode | null | undefined): boolean => {
  if (!argument) return false;
  if (isNodeOfType(argument, "Literal")) return true;
  return isNodeOfType(argument, "TemplateLiteral") && (argument.expressions?.length ?? 0) === 0;
};

// `RegExp(...)` without `new` constructs a fresh regex exactly like
// `new RegExp(...)` does, so both call forms get the same treatment.
const isStaticRegExpConstruction = (
  node: EsTreeNodeOfType<"NewExpression"> | EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const patternArgument = node.arguments?.[0] as EsTreeNode | undefined;
  const flagsArgument = node.arguments?.[1] as EsTreeNode | undefined;
  return (
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "RegExp" &&
    isStaticPattern(patternArgument) &&
    (flagsArgument === undefined || isStaticPattern(flagsArgument))
  );
};

const MESSAGE =
  "`new RegExp()` rebuilds the pattern on every loop pass. Move it to a constant outside the loop.";

export const jsHoistRegexp = defineRule({
  id: "js-hoist-regexp",
  title: "RegExp built inside a loop",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move `new RegExp(...)` (or large regex literals) to a constant outside the loop so it isn't rebuilt on every pass",
  create: (context: RuleContext) =>
    createLoopAwareVisitors(
      {
        NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
          if (isStaticRegExpConstruction(node)) {
            context.report({ node, message: MESSAGE });
          }
        },
        CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
          if (isStaticRegExpConstruction(node)) {
            context.report({ node, message: MESSAGE });
          }
        },
      },
      { treatIteratorCallbacksAsLoops: true },
    ),
});
