import { EFFECT_HOOK_NAMES } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const renderingHydrationNoFlicker = defineRule<Rule>({
  recommendation:
    "Use `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` or add `suppressHydrationWarning` to the element",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;

      const depsNode = node.arguments[1];
      if (depsNode.type !== "ArrayExpression" || depsNode.elements?.length !== 0) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      const bodyStatements =
        callback.body?.type === "BlockStatement" ? callback.body.body : [callback.body];
      if (!bodyStatements || bodyStatements.length !== 1) return;

      const soleStatement = bodyStatements[0];
      if (soleStatement?.type === "ExpressionStatement" && isSetterCall(soleStatement.expression)) {
        context.report({
          node,
          message:
            "useEffect(setState, []) on mount causes a flash — consider useSyncExternalStore or suppressHydrationWarning",
        });
      }
    },
  }),
});
