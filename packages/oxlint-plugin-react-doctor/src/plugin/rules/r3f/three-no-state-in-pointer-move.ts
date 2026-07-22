import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  isGuardedStateTransition,
  resolveStateSetterBinding,
} from "./r3f-no-state-in-use-frame.js";
import { resolveThreePointerMoveCallback } from "./utils/resolve-three-pointer-move-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

export const threeNoStateInPointerMove = defineRule({
  id: "three-no-state-in-pointer-move",
  title: "React state update inside Three.js pointer-move handler",
  severity: "warn",
  recommendation:
    "Keep continuous pointer previews in Three.js objects or refs and publish React state when the interaction commits",
  create: (context: RuleContext) => {
    const analyzedCallbacks = new Set<EsTreeNode>();
    const analyzeCallback = (node: EsTreeNode): void => {
      const callback = resolveThreePointerMoveCallback(node, context);
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
            "This React state update can render on every pointer movement. Mutate a Three.js object or ref and publish state on pointer-up",
        });
      });
    };
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        analyzeCallback(node);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        analyzeCallback(node);
      },
    };
  },
});
