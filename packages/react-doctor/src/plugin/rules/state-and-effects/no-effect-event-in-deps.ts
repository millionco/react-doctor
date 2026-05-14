import { HOOKS_WITH_DEPS } from "../../constants.js";
import { createComponentBindingStackTracker } from "../../utils/create-component-binding-stack-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// HACK: useEffectEvent's identity is intentionally unstable — it captures
// the latest props/state on each call. Listing it in a useEffect/useMemo/
// useCallback dep array fundamentally misuses the API and would cause the
// effect to re-run constantly. The recommended pattern is to call the
// effect-event from inside the effect body without listing it as a dep.
//
// Bindings are scoped per-component using a stack so a `useEffectEvent`
// binding named `onChange` in ComponentA doesn't taint a regular variable
// `onChange` in ComponentB in the same file.
export const noEffectEventInDeps = defineRule<Rule>({
  framework: "global",
  severity: "error",
  category: "State & Effects",
  recommendation:
    "Call the useEffectEvent callback inside the effect body without listing it; its identity is intentionally unstable",
  create: (context: RuleContext) => {
    const componentBindings = createComponentBindingStackTracker({
      onVariableDeclarator: (declaratorNode: EsTreeNode) => {
        if (!isNodeOfType(declaratorNode.id, "Identifier")) return;
        const initializer = declaratorNode.init;
        if (!initializer || !isNodeOfType(initializer, "CallExpression")) return;
        if (!isHookCall(initializer, "useEffectEvent")) return;
        componentBindings.addBindingToCurrentFrame(declaratorNode.id.name);
      },
    });

    return {
      ...componentBindings.visitors,
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, HOOKS_WITH_DEPS) || node.arguments.length < 2) return;
        if (!componentBindings.isInsideComponent()) return;
        const depsNode = node.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression")) return;

        for (const element of depsNode.elements ?? []) {
          if (!isNodeOfType(element, "Identifier")) continue;
          if (componentBindings.isBoundName(element.name)) {
            context.report({
              node: element,
              message: `"${element.name}" is from useEffectEvent and must not be in the deps array — its identity is intentionally unstable; call it inside the effect without listing it`,
            });
          }
        }
      },
    };
  },
});
