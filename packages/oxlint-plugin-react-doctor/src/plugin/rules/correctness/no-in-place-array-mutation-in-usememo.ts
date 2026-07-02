import { MUTATING_ARRAY_METHODS } from "../../constants/js.js";
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

// Global-object roots (`window.dataLayer.push(...)`, `window._paq.push([...])`)
// are vendor command queues, not React render data — pushing onto them is the
// documented API, so a copy would break tracking.
const GLOBAL_OBJECT_ROOT_NAMES = new Set(["window", "globalThis", "self", "document"]);

// Returns the useMemo callback that DIRECTLY encloses `node` — the call must
// sit in the callback's own body, not in a deeper nested function (which may
// never run during memoization). useCallback bodies are deferred imperative
// code, not memo derivations, so they are deliberately out of scope. Null
// otherwise.
const enclosingMemoCallback = (node: EsTreeNode): EsTreeNode | null => {
  const functionNode = nearestEnclosingFunction(node);
  if (!functionNode) return null;
  const parent = functionNode.parent;
  if (
    parent &&
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments?.[0] === functionNode &&
    isHookCall(parent, "useMemo")
  ) {
    return functionNode;
  }
  return null;
};

// A `.current` in the receiver chain (`stackRef.current.push()`,
// `ref.current[key].splice()`) means the mutated array lives inside a React
// ref — a container the component deliberately keeps mutable and outside the
// render data flow, so mutating it in place is the documented pattern, not
// shared props / cache corruption.
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

const isDeclaredWithin = (bindingIdentifier: EsTreeNode, callbackFunction: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = bindingIdentifier;
  while (cursor) {
    if (cursor === callbackFunction) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

// A binding destructured as element [0] of a setter-less `useState(...)`
// (`const [subscribers] = useState({})`) is the stable-mutable-container
// idiom — semantically identical to the already-exempt `ref.current` chain.
const isSetterlessUseStateBinding = (bindingIdentifier: EsTreeNode): boolean => {
  const arrayPattern = bindingIdentifier.parent;
  if (!arrayPattern || !isNodeOfType(arrayPattern, "ArrayPattern")) return false;
  const elements = Array.isArray(arrayPattern.elements) ? arrayPattern.elements : [];
  if (elements[0] !== bindingIdentifier) return false;
  if (elements.filter(Boolean).length !== 1) return false;
  const declarator = arrayPattern.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
    return false;
  }
  return isHookCall(stripParenExpression(declarator.init), "useState");
};

// True when the binding identifier sits inside a function's parameter list
// (directly or through a destructuring pattern) — i.e. it is provably a
// caller-supplied value like a destructured prop, never a fresh local.
const isBindingAFunctionParameter = (bindingIdentifier: EsTreeNode): boolean => {
  let cursor: EsTreeNode = bindingIdentifier;
  let ancestor: EsTreeNode | null | undefined = cursor.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "VariableDeclarator")) return false;
    if (
      isNodeOfType(ancestor, "FunctionDeclaration") ||
      isNodeOfType(ancestor, "FunctionExpression") ||
      isNodeOfType(ancestor, "ArrowFunctionExpression")
    ) {
      return (
        Array.isArray(ancestor.params) &&
        ancestor.params.some((parameterNode) => parameterNode === cursor)
      );
    }
    cursor = ancestor;
    ancestor = cursor.parent ?? null;
  }
  return false;
};

export const noInPlaceArrayMutationInUseMemo = defineRule({
  id: "no-in-place-array-mutation-in-usememo",
  title: "In-place array mutation inside useMemo",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Copy the array before sorting/reversing (`[...items].sort(...)` or `items.toSorted(...)`). A useMemo callback should be a pure derivation; mutating a props / query-cache / Formik array in place corrupts shared state and downstream identity checks miss the change.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const methodName = getCallMethodName(node.callee);
      if (!methodName || !MUTATING_ARRAY_METHODS.has(methodName)) return;

      const callbackFunction = enclosingMemoCallback(node);
      if (!callbackFunction) return;

      // `callee` is `<receiver>.<method>` — the receiver is what gets mutated.
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      const receiver = stripParenExpression(node.callee.object);

      const isBareIdentifierReceiver = isNodeOfType(receiver, "Identifier");
      if (!isBareIdentifierReceiver && !isNodeOfType(receiver, "MemberExpression")) return;
      if (!isBareIdentifierReceiver && receiverReachesThroughRefCurrent(receiver)) return;

      const rootName = getRootIdentifierName(receiver);
      // No plain-identifier root (e.g. `[...arr].foo.sort()`) — can't prove the
      // receiver is foreign, so stay quiet.
      if (!rootName) return;
      if (GLOBAL_OBJECT_ROOT_NAMES.has(rootName)) return;

      let rootIdentifier: EsTreeNode = receiver;
      while (isNodeOfType(rootIdentifier, "MemberExpression")) {
        rootIdentifier = stripParenExpression(rootIdentifier.object);
      }
      if (!isNodeOfType(rootIdentifier, "Identifier")) return;

      const binding = findVariableInitializer(rootIdentifier, rootName);

      if (isBareIdentifierReceiver) {
        // A bare receiver (`items.sort()`) is only provably foreign when it is
        // a function parameter — a destructured prop or hook argument. Locals,
        // imports, and unresolved names stay quiet.
        if (!binding) return;
        if (!isBindingAFunctionParameter(binding.bindingIdentifier)) return;
        if (isDeclaredWithin(binding.bindingIdentifier, callbackFunction)) return;
      } else if (binding) {
        if (isDeclaredWithin(binding.bindingIdentifier, callbackFunction)) return;
        if (isSetterlessUseStateBinding(binding.bindingIdentifier)) return;
      }

      context.report({
        node,
        message: `.${methodName}() mutates an array reached through "${rootName}" in place inside this memo, corrupting shared props / query-cache / Formik data; copy it first with \`[...]\` or use a non-mutating method like \`.toSorted(...)\`.`,
      });
    },
  }),
});
