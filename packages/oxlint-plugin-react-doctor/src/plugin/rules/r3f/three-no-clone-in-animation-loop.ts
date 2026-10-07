import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { hasThreeObjectProvenance } from "./utils/has-three-object-provenance.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

export const threeNoCloneInAnimationLoop = defineRule({
  id: "three-no-clone-in-animation-loop",
  title: "Three.js clone inside animation loop",
  severity: "warn",
  recommendation:
    "Clone once before the animation loop or copy values into a reusable scratch object during frames",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate, isConditionallyExecuted) => {
          if (
            isConditionallyExecuted ||
            !isNodeOfType(candidate, "CallExpression") ||
            !isNodeOfType(candidate.callee, "MemberExpression") ||
            getStaticPropertyName(candidate.callee) !== "clone" ||
            !hasThreeObjectProvenance(candidate.callee.object, context.scopes)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This clone allocates a new Three.js object every executed frame. Copy into a reusable object or clone once outside the animation loop",
          });
        });
      },
    };
  },
});
