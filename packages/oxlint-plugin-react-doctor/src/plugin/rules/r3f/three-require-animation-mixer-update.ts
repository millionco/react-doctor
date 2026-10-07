import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { animationCallbackUpdatesMixer } from "./utils/animation-callback-updates-mixer.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { resolveThreeAnimationLoopCallback } from "./utils/resolve-three-animation-loop-callback.js";

interface MixerActionFact {
  readonly mixerKey: string;
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly owner: EsTreeNode | null;
}

export const threeRequireAnimationMixerUpdate = defineRule({
  id: "three-require-animation-mixer-update",
  title: "Three.js animation mixer is never advanced",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Call mixer.update(deltaSeconds) from the renderer animation loop after starting mixer actions",
  create: (context: RuleContext) => {
    const animationCallbacks = new Map<EsTreeNode, EsTreeNode | null>();
    const mixerActions: MixerActionFact[] = [];
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveThreeAnimationLoopCallback(node, context.scopes);
        if (callback) animationCallbacks.set(callback, findEnclosingFunction(node));
        if (
          !isNodeOfType(node.callee, "MemberExpression") ||
          getStaticPropertyName(node.callee) !== "clipAction" ||
          getThreeConstructorName(node.callee.object, context.scopes) !== "AnimationMixer"
        ) {
          return;
        }
        const mixerKey = resolveExpressionKey(node.callee.object, context);
        if (mixerKey) mixerActions.push({ mixerKey, node, owner: findEnclosingFunction(node) });
      },
      "Program:exit"() {
        if (animationCallbacks.size === 0) return;
        const reportedMixerKeys = new Set<string>();
        for (const action of mixerActions) {
          const ownedCallbacks = [...animationCallbacks].filter(
            ([, owner]) => owner === action.owner,
          );
          if (ownedCallbacks.length === 0) continue;
          if (
            reportedMixerKeys.has(action.mixerKey) ||
            ownedCallbacks.some(([callback]) =>
              animationCallbackUpdatesMixer(callback, action.mixerKey, context),
            )
          ) {
            continue;
          }
          reportedMixerKeys.add(action.mixerKey);
          context.report({
            node: action.node,
            message:
              "This AnimationMixer creates an action, but no proven Three.js animation callback advances it with mixer.update(deltaSeconds)",
          });
        }
      },
    };
  },
});
