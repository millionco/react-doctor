import { MUTATING_ARRAY_METHODS } from "../../constants/js.js";
import { MEMOIZING_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getCallMethodName } from "../../utils/get-call-method-name.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { nearestEnclosingFunction } from "../../utils/component-or-hook-display-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Returns the useMemo/useCallback callback that DIRECTLY encloses `node` — the
// call must sit in the callback's own body, not in a deeper nested function
// (which may never run during memoization). Null otherwise.
const enclosingMemoCallback = (node: EsTreeNode): EsTreeNode | null => {
  const functionNode = nearestEnclosingFunction(node);
  if (!functionNode) return null;
  const parent = functionNode.parent;
  if (
    parent &&
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments?.[0] === functionNode &&
    isHookCall(parent, MEMOIZING_HOOK_NAMES)
  ) {
    return functionNode;
  }
  return null;
};

// A `.current` in the receiver chain (`stackRef.current.push()`,
// `ref.current[key].splice()`) means the mutated array lives inside a React
// ref — a container the component deliberately keeps mutable and outside the
// render data flow, so mutating it in place is the documented pattern, not
// shared props / cache corruption. Excluding it removes the dominant false
// positive (undo/redo stacks, pointer queues) while leaving foreign arrays
// reached through plain member access (`props.rows`, `values.images`) flagged.
const receiverReachesThroughRefCurrent = (receiver: EsTreeNode): boolean => {
  let cursor: EsTreeNode = receiver;
  while (isNodeOfType(cursor, "MemberExpression")) {
    if (
      !cursor.computed &&
      isNodeOfType(cursor.property, "Identifier") &&
      cursor.property.name === "current"
    ) {
      return true;
    }
    cursor = stripParenExpression(cursor.object);
  }
  return false;
};

// A root identifier is callback-owned when its binding is declared inside the
// memo callback (its params, or any variable — regardless of initializer form:
// literal, `groupBy(...)`, destructure, etc.). Mutating an object the callback
// created is always safe.
const isRootDeclaredWithinCallback = (
  rootIdentifier: EsTreeNode,
  rootName: string,
  callbackFunction: EsTreeNode
): boolean => {
  const binding = findVariableInitializer(rootIdentifier, rootName);
  if (!binding) return false;
  let cursor: EsTreeNode | null | undefined = binding.bindingIdentifier;
  while (cursor) {
    if (cursor === callbackFunction) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

export const noInPlaceArrayMutationInUseMemo = defineRule({
  id: "no-in-place-array-mutation-in-usememo",
  title: "In-place array mutation inside useMemo or useCallback",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Copy the array before sorting/reversing (`[...items].sort(...)` or `items.toSorted(...)`). A useMemo/useCallback callback should be a pure derivation; mutating a props / query-cache / Formik array in place corrupts shared state and downstream identity checks miss the change.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const methodName = getCallMethodName(node.callee);
      if (!methodName || !MUTATING_ARRAY_METHODS.has(methodName)) return;

      const callbackFunction = enclosingMemoCallback(node);
      if (!callbackFunction) return;

      // `callee` is `<receiver>.<method>` — the receiver is what gets mutated.
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      const receiver = stripParenExpression(node.callee.object);
      // Bare-Identifier receivers (`const fresh = ...; fresh.sort()`) are never
      // flagged; only a member-expression receiver points at a foreign object.
      if (!isNodeOfType(receiver, "MemberExpression")) return;
      if (receiverReachesThroughRefCurrent(receiver)) return;

      const rootName = getRootIdentifierName(receiver);
      // No plain-identifier root (e.g. `[...arr].foo.sort()`) — can't prove the
      // receiver is foreign, so stay quiet.
      if (!rootName) return;

      let rootIdentifier: EsTreeNode = receiver;
      while (isNodeOfType(rootIdentifier, "MemberExpression")) {
        rootIdentifier = stripParenExpression(rootIdentifier.object);
      }
      if (!isNodeOfType(rootIdentifier, "Identifier")) return;

      if (
        isRootDeclaredWithinCallback(rootIdentifier, rootName, callbackFunction)
      )
        return;

      context.report({
        node,
        message: `.${methodName}() mutates an array reached through "${rootName}" in place inside this memo, corrupting shared props / query-cache / Formik data; copy it first with \`[...]\` or use a non-mutating method like \`.toSorted(...)\`.`,
      });
    },
  }),
});
