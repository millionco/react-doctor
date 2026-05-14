import type { ComponentBindingStackTracker } from "./component-binding-stack-tracker.js";
import type { ComponentBindingStackTrackerCallbacks } from "./component-binding-stack-tracker-callbacks.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isComponentAssignment } from "./is-component-assignment.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isUppercaseName } from "./is-uppercase-name.js";
import type { RuleVisitors } from "./rule-visitors.js";

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
export const createComponentBindingStackTracker = (
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
