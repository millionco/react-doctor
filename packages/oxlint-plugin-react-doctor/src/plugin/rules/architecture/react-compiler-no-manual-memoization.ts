import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  getImportedNameFromModule,
  isImportedFromModule,
} from "../../utils/find-import-source-for-name.js";
import { isCanonicalReactNamespaceName } from "../../utils/is-canonical-react-namespace-name.js";
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

const resolveRemovalMessageForCallee = (callee: EsTreeNode): string | null => {
  const apiName =
    resolveReactApiNameForIdentifier(callee) ?? resolveReactApiNameForMemberExpression(callee);
  if (!apiName) return null;
  return REMOVAL_MESSAGE_BY_REACT_API_NAME.get(apiName) ?? null;
};

// Active only when React Compiler is detected (`requires:
// ["react-compiler"]` in the rule registry). Userland helpers and
// `useMemo` from non-react packages are filtered out by the import-
// source check below. Composes with `react-hooks-js/preserve-manual-
// memoization`, which inverts the rule for cases the compiler cannot
// safely auto-memoize.
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
