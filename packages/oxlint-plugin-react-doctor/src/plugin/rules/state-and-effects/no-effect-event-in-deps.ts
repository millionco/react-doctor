import { HOOKS_WITH_DEPS } from "../../constants/react.js";
import type { ComponentBindingStackTrackerCallbacks } from "../../utils/component-binding-stack-tracker-callbacks.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

interface ComponentBindingStackTracker {
  isInsideComponent: () => boolean;
  isBoundName: (name: string) => boolean;
  addBindingToCurrentFrame: (name: string) => void;
  visitors: RuleVisitors;
}

// HACK: sibling of `createComponentPropStackTracker` for rules that need
// to track *binding* sets per component scope rather than the destructured
// prop set - e.g. `no-effect-event-in-deps` accumulates the names of
// `useEffectEvent` declarators while inside a component and then queries
// "is this dep-array identifier one of our useEffectEvent bindings?".
//
// Three rules previously reimplemented this push/pop bookkeeping inline.
// They now share the same scaffold; the per-rule predicate (e.g. "is the
// initializer a `useEffectEvent(...)` call?") lives in the
// `onVariableDeclarator` callback.
//
// The barrier semantic is intentionally simpler than the prop-stack
// tracker: the rule (e.g. `no-effect-event-in-deps`) only mutates the
// top frame for VariableDeclarators directly inside a component, and
// the stack only grows on FunctionDeclaration / VariableDeclarator
// component entries, so a closed-over name from an outer component
// can't leak in via a nested helper.
const createComponentBindingStackTracker = (
  callbacks?: ComponentBindingStackTrackerCallbacks,
): ComponentBindingStackTracker => {
  const componentBindingStack: Array<Set<string>> = [];

  const isInsideComponent = (): boolean => componentBindingStack.length > 0;

  const isBoundName = (name: string): boolean => {
    for (let frameIndex = componentBindingStack.length - 1; frameIndex >= 0; frameIndex--) {
      if (componentBindingStack[frameIndex].has(name)) return true;
    }
    return false;
  };

  const addBindingToCurrentFrame = (name: string): void => {
    if (componentBindingStack.length === 0) return;
    componentBindingStack[componentBindingStack.length - 1].add(name);
  };

  const visitors: RuleVisitors = {
    FunctionDeclaration(node: EsTreeNode) {
      if (!isNodeOfType(node, "FunctionDeclaration")) return;
      if (!node.id || !isUppercaseName(node.id.name)) return;
      componentBindingStack.push(new Set());
    },
    "FunctionDeclaration:exit"(node: EsTreeNode) {
      if (!isNodeOfType(node, "FunctionDeclaration")) return;
      if (!node.id || !isUppercaseName(node.id.name)) return;
      componentBindingStack.pop();
    },
    VariableDeclarator(node: EsTreeNode) {
      if (isComponentAssignment(node)) {
        componentBindingStack.push(new Set());
        return;
      }
      callbacks?.onVariableDeclarator?.(node);
    },
    "VariableDeclarator:exit"(node: EsTreeNode) {
      if (isComponentAssignment(node)) componentBindingStack.pop();
    },
  };

  return { isInsideComponent, isBoundName, addBindingToCurrentFrame, visitors };
};

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
  id: "no-effect-event-in-deps",
  severity: "error",
  recommendation:
    "Call the useEffectEvent callback inside the effect body without listing it; its identity is intentionally unstable",
  create: (context: RuleContext) => {
    const componentBindings = createComponentBindingStackTracker({
      onVariableDeclarator: (declaratorNode: EsTreeNode) => {
        if (!isNodeOfType(declaratorNode, "VariableDeclarator")) return;
        if (!isNodeOfType(declaratorNode.id, "Identifier")) return;
        const initializer = declaratorNode.init;
        if (!initializer || !isNodeOfType(initializer, "CallExpression")) return;
        if (!isHookCall(initializer, "useEffectEvent")) return;
        componentBindings.addBindingToCurrentFrame(declaratorNode.id.name);
      },
    });

    return {
      ...componentBindings.visitors,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
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
