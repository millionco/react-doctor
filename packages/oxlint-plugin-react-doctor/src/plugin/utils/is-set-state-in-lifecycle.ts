import type { EsTreeNode } from "./es-tree-node.js";
import { isEs5Component } from "./is-es5-component.js";
import { isEs6Component } from "./is-es6-component.js";
import { isImmediatelyInvokedFunction } from "./is-immediately-invoked-function.js";
import { isNodeOfType } from "./is-node-of-type.js";

const FUNCTION_NODE_TYPES = new Set<string>([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const isLifecycleMember = (node: EsTreeNode, lifecycleNames: ReadonlySet<string>): boolean => {
  if (
    isNodeOfType(node, "MethodDefinition") ||
    isNodeOfType(node, "Property") ||
    isNodeOfType(node, "PropertyDefinition")
  ) {
    const key = (node as { key?: EsTreeNode }).key;
    if (!key) return false;
    if (isNodeOfType(key, "Identifier")) return lifecycleNames.has(key.name);
    if (isNodeOfType(key, "Literal") && typeof key.value === "string") {
      return lifecycleNames.has(key.value);
    }
  }
  return false;
};

export interface SetStateInLifecycleOptions {
  // When true, `setState` calls nested inside a callback / inner function
  // inside the lifecycle method are also flagged. Default: false (matches
  // OXC's `Allowed` default — only direct calls in the lifecycle body).
  disallowInNestedFunctions?: boolean;
}

// Helper used by no-did-mount-set-state, no-did-update-set-state, etc.
// Walks up `node.parent` from a `this.setState(...)` call, finds the
// enclosing lifecycle method (whose name must match the rule's
// `lifecycleNames` set), and confirms that lifecycle method is inside an
// es5/es6 React component.
//
// Returns true when the call should be flagged.
export const isSetStateCallInLifecycle = (
  setStateCall: EsTreeNode,
  lifecycleNames: ReadonlySet<string>,
  options: SetStateInLifecycleOptions = {},
): boolean => {
  let lifecycleMember: EsTreeNode | null = null;
  let nestedFunctionCount = 0;

  let ancestor: EsTreeNode | null | undefined = setStateCall.parent;
  while (ancestor) {
    if (!lifecycleMember) {
      if (
        FUNCTION_NODE_TYPES.has(ancestor.type) &&
        (!isImmediatelyInvokedFunction(ancestor) ||
          !("async" in ancestor) ||
          ancestor.async === true)
      ) {
        nestedFunctionCount += 1;
      }
      if (isLifecycleMember(ancestor, lifecycleNames)) {
        lifecycleMember = ancestor;
      }
    } else {
      if (isEs5Component(ancestor) || isEs6Component(ancestor)) {
        // Lifecycle method belongs to a React component. Apply nested-fn rule.
        if (nestedFunctionCount > 1 && !options.disallowInNestedFunctions) return false;
        return true;
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};
