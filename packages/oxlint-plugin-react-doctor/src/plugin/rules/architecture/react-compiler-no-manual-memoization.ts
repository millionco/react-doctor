import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import {
  getImportedNameFromModule,
  isImportedFromModule,
} from "../../utils/find-import-source-for-name.js";
import { isCanonicalReactNamespaceName } from "../../utils/is-canonical-react-namespace-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentOrHookName } from "../../utils/is-react-component-or-hook-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const REMOVAL_MESSAGE_BY_REACT_API_NAME = new Map<string, string>([
  [
    "useMemo",
    "This `useMemo` is dead weight, since React Compiler already caches every value here. Delete it.",
  ],
  [
    "useCallback",
    "This `useCallback` is dead weight, since React Compiler already caches every function here. Delete it.",
  ],
  [
    "memo",
    "This `memo()` is dead weight, since React Compiler already caches the component's output. Delete it.",
  ],
]);

// Resolves a callee identifier (e.g. `memoize` in `memoize(...)`) to
// the React API it ultimately points at, OR null if it doesn't point
// at one. Handles three import shapes:
//   import { memo } from "react"                     → "memo"
//   import { useMemo as memoize } from "react"       → "useMemo"
//   import * as ReactNS from "react"; ReactNS.memo() → namespace path
const resolveReactApiNameForIdentifier = (callee: EsTreeNode): string | null => {
  if (!isNodeOfType(callee, "Identifier")) return null;
  const importedName = getImportedNameFromModule(callee, callee.name, "react");
  if (importedName && REMOVAL_MESSAGE_BY_REACT_API_NAME.has(importedName)) {
    return importedName;
  }
  return null;
};

const resolveReactApiNameForMemberExpression = (callee: EsTreeNode): string | null => {
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  if (callee.computed) return null;
  const namespaceIdentifier = callee.object;
  const propertyIdentifier = callee.property;
  if (!isNodeOfType(namespaceIdentifier, "Identifier")) return null;
  if (!isNodeOfType(propertyIdentifier, "Identifier")) return null;
  if (!REMOVAL_MESSAGE_BY_REACT_API_NAME.has(propertyIdentifier.name)) return null;
  const namespaceName = namespaceIdentifier.name;
  if (isCanonicalReactNamespaceName(namespaceName)) return propertyIdentifier.name;
  if (isImportedFromModule(namespaceIdentifier, namespaceName, "react")) {
    return propertyIdentifier.name;
  }
  return null;
};

const resolveReactApiNameForCallee = (callee: EsTreeNode): string | null =>
  resolveReactApiNameForIdentifier(callee) ?? resolveReactApiNameForMemberExpression(callee);

// `memo(Inner, undefined)` / `memo(Inner, null)` make React fall back to
// the default shallow compare — exactly as redundant under React Compiler
// as `memo(Inner)`. Any other second-arg shape (function expression,
// identifier, member/call expression, spread) could be a real comparator,
// so it keeps the exemption.
const isNullishComparatorArgument = (argumentNode: EsTreeNode): boolean =>
  (isNodeOfType(argumentNode, "Identifier") && argumentNode.name === "undefined") ||
  (isNodeOfType(argumentNode, "Literal") && argumentNode.value === null);

// The only HOC wrappers React Compiler's infer mode recognizes as a
// compilation opt-in. Deliberately narrower than the plugin-wide
// `COMPONENT_HOC_WRAPPER_NAMES` (which also names `observer` / `lazy`):
// the compiler skips functions wrapped in arbitrary HOCs, so their
// manual memoization stays load-bearing.
const COMPILER_INFERABLE_HOC_NAMES = new Set(["memo", "forwardRef"]);

const calleeTrailingName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return callee.property.name;
  }
  return null;
};

// Whether React Compiler's infer mode will compile `functionNode`: a
// function named like a component/hook (directly or via its variable
// binding), or one wrapped in `memo` / `forwardRef`. Anonymous functions
// handed to arbitrary HOCs (`NiceModal.create(() => …)`) are skipped by
// the compiler, so hooks inside them are never auto-cached.
const isCompilerInferableFunction = (functionNode: EsTreeNode): boolean => {
  if (
    (isNodeOfType(functionNode, "FunctionDeclaration") ||
      isNodeOfType(functionNode, "FunctionExpression")) &&
    functionNode.id
  ) {
    return isReactComponentOrHookName(functionNode.id.name);
  }
  const parent = functionNode.parent;
  if (parent && isNodeOfType(parent, "CallExpression")) {
    if (parent.arguments?.[0] !== functionNode) return false;
    const calleeName = calleeTrailingName(parent.callee);
    return calleeName !== null && COMPILER_INFERABLE_HOC_NAMES.has(calleeName);
  }
  if (parent && isNodeOfType(parent, "VariableDeclarator")) {
    return (
      isNodeOfType(parent.id, "Identifier") &&
      parent.init === functionNode &&
      isReactComponentOrHookName(parent.id.name)
    );
  }
  return false;
};

// Active only when React Compiler is detected (`requires:
// ["react-compiler"]` in the rule registry). Userland helpers and
// `useMemo` from non-react packages are filtered out by the import-
// source check below. Composes with `react-hooks-js/preserve-manual-
// memoization`, which inverts the rule for cases the compiler cannot
// safely auto-memoize.
export const reactCompilerNoManualMemoization = defineRule({
  id: "react-compiler-no-manual-memoization",
  title: "Redundant manual memoization",
  // Redundant-memo cleanup is correctness-neutral: the code already works,
  // the compiler just makes the `useMemo` / `useCallback` / `memo` redundant.
  // On a compiler-enabled codebase that's hundreds of low-priority hits, so
  // it ships as a warning (hidden in the default report). Opt back into
  // errors with the `compiler-cleanup` severity bucket.
  severity: "warn",
  requires: ["react-compiler"],
  recommendation:
    "Delete the `useMemo` / `useCallback` / `memo` call and use the plain value or component. React Compiler caches it for you.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const apiName = resolveReactApiNameForCallee(node.callee);
      if (!apiName) return;
      // `memo(Component, areEqual)` with a custom comparator encodes
      // bespoke equality the compiler can't replicate, so it isn't
      // redundant — leave it alone. A nullish second arg is no comparator
      // at all, so it doesn't earn the exemption.
      if (apiName === "memo") {
        const comparatorArgument = node.arguments?.[1];
        if (comparatorArgument && !isNullishComparatorArgument(comparatorArgument)) return;
      } else {
        // `useMemo` / `useCallback` are only redundant inside a function
        // the compiler will actually compile. Inside a function it skips
        // (an anonymous arrow handed to a non-React HOC, a non-component
        // helper) nothing is auto-cached, so the manual memoization stays.
        const enclosingFunction = findEnclosingFunction(node);
        if (!enclosingFunction || !isCompilerInferableFunction(enclosingFunction)) return;
      }
      const removalMessage = REMOVAL_MESSAGE_BY_REACT_API_NAME.get(apiName);
      if (!removalMessage) return;
      context.report({
        node,
        message: removalMessage,
      });
    },
  }),
});
