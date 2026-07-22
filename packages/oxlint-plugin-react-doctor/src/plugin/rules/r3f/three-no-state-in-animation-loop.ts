import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  isGuardedStateTransition,
  resolveStateSetterBinding,
} from "./r3f-no-state-in-use-frame.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

export const threeNoStateInAnimationLoop = defineRule({
  id: "three-no-state-in-animation-loop",
  title: "React state update inside Three.js animation loop",
  severity: "warn",
  recommendation:
    "Mutate Three.js objects or refs during frames; reserve React state for guarded, infrequent transitions",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (!callback || analyzedCallbacks.has(callback)) return;
        analyzedCallbacks.add(callback);
        walkFunctionExecution(callback, context.scopes, (candidate) => {
          if (
            !isNodeOfType(candidate, "CallExpression") ||
            !resolveStateSetterBinding(candidate.callee, context.scopes) ||
            isGuardedStateTransition(candidate, callback, context.scopes)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This React state update can schedule a component render every frame. Mutate a Three.js object or ref, or guard an infrequent state transition",
          });
        });
      },
    };
  },
});
