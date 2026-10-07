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
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";

interface MixerActionFact {
  readonly mixerKey: string;
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly owner: EsTreeNode | null;
}

export const r3fRequireAnimationMixerUpdate = defineRule({
  id: "r3f-require-animation-mixer-update",
  title: "R3F animation mixer is never advanced",
  category: "Correctness",
  severity: "error",
  recommendation: "Call mixer.update(delta) from useFrame after starting mixer actions",
  create: (context: RuleContext) => {
    const frameCallbacks = new Map<EsTreeNode, EsTreeNode | null>();
    const mixerActions: MixerActionFact[] = [];
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (callback) frameCallbacks.set(callback, findEnclosingFunction(node));
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
        if (frameCallbacks.size === 0) return;
        const reportedMixerKeys = new Set<string>();
        for (const action of mixerActions) {
          const ownedCallbacks = [...frameCallbacks].filter(([, owner]) => owner === action.owner);
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
              "This AnimationMixer creates an action, but no proven useFrame callback advances it with mixer.update(delta)",
          });
        }
      },
    };
  },
});
