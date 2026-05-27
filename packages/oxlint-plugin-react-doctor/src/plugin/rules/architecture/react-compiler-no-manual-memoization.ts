import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isImportedFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const REMOVAL_MESSAGE_BY_REACT_API_NAME = new Map<string, string>([
  [
    "useMemo",
    "Remove `useMemo` — React Compiler auto-memoizes every value in this component. Manual `useMemo` adds noise without improving performance.",
  ],
  [
    "useCallback",
    "Remove `useCallback` — React Compiler auto-memoizes every function in this component. Manual `useCallback` adds noise without improving performance.",
  ],
  [
    "memo",
    "Remove `memo()` — React Compiler memoizes component output automatically. Wrapping with `memo` is redundant and obscures the component tree.",
  ],
]);

const REACT_NAMESPACE_NAME_PREFIXES = ["React", "react", "_react", "_React"] as const;

const isCanonicalReactNamespaceName = (namespaceName: string): boolean => {
  for (const reactNamespacePrefix of REACT_NAMESPACE_NAME_PREFIXES) {
    if (namespaceName === reactNamespacePrefix) return true;
    if (namespaceName.startsWith(reactNamespacePrefix)) return true;
  }
  return false;
};

const resolveRemovalMessageForCallee = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) {
    const removalMessage = REMOVAL_MESSAGE_BY_REACT_API_NAME.get(callee.name);
    if (!removalMessage) return null;
    if (!isImportedFromModule(callee, callee.name, "react")) return null;
    return removalMessage;
  }
  if (isNodeOfType(callee, "MemberExpression")) {
    if (callee.computed) return null;
    const namespaceIdentifier = callee.object;
    const propertyIdentifier = callee.property;
    if (!isNodeOfType(namespaceIdentifier, "Identifier")) return null;
    if (!isNodeOfType(propertyIdentifier, "Identifier")) return null;
    const removalMessage = REMOVAL_MESSAGE_BY_REACT_API_NAME.get(propertyIdentifier.name);
    if (!removalMessage) return null;
    const namespaceName = namespaceIdentifier.name;
    if (isCanonicalReactNamespaceName(namespaceName)) return removalMessage;
    if (isImportedFromModule(namespaceIdentifier, namespaceName, "react")) return removalMessage;
    return null;
  }
  return null;
};

// Active only when React Compiler is detected for the project (the
// rule registry gates this with `requires: ["react-compiler"]`). When
// the compiler is on, `useMemo`, `useCallback`, and `memo(...)` are
// strictly redundant — the compiler memoizes every value, every
// function, and every component output automatically. Manual
// memoization adds maintenance overhead and hides bugs (stale deps in
// `useMemo`/`useCallback`, redundant equality checks in `memo`).
//
// The rule only fires when the callee resolves back to the `react`
// package (named import, namespace import, or canonical `React.`
// prefix). Userland `useMemo` / `useCallback` / `memo` helpers
// (Lodash's `memoize`, custom `useMemo` lookalikes, etc.) are
// untouched. The `react-hooks-js/preserve-manual-memoization`
// compiler-frontend rule continues to flag the *opposite* case —
// removals the compiler can't safely auto-memoize — so the two rules
// compose: this one drives removal, the compiler frontend protects
// the cases that must stay.
export const reactCompilerNoManualMemoization = defineRule<Rule>({
  id: "react-compiler-no-manual-memoization",
  severity: "error",
  requires: ["react-compiler"],
  recommendation:
    "Delete the `useMemo` / `useCallback` / `memo` call and use the bare expression or component — React Compiler memoizes it for you.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const removalMessage = resolveRemovalMessageForCallee(node.callee);
      if (!removalMessage) return;
      context.report({
        node,
        message: removalMessage,
      });
    },
  }),
});
