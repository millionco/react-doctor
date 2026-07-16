import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedNameFromModule, isImportedFromModule } from "./find-import-source-for-name.js";
import { isCanonicalReactNamespaceName } from "./is-canonical-react-namespace-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// Modules whose `createContext` export has React's identity semantics.
const CONTEXT_MODULES = ["react", "use-context-selector", "react-tracked"];

// True when `callee` resolves to such a `createContext`: named-imported
// (including renamed) from a CONTEXT_MODULES entry, or accessed on the
// canonical React namespace / a namespace imported from one of them.
export const isCreateContextCallee = (callee: EsTreeNode): boolean => {
  if (isNodeOfType(callee, "Identifier")) {
    return CONTEXT_MODULES.some(
      (moduleName) =>
        getImportedNameFromModule(callee, callee.name, moduleName) === "createContext",
    );
  }
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  const namespaceIdentifier = callee.object;
  if (!isNodeOfType(namespaceIdentifier, "Identifier")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (callee.property.name !== "createContext") return false;
  if (isCanonicalReactNamespaceName(namespaceIdentifier.name)) return true;
  // `isImportedFromModule` (not `getImportedNameFromModule !== null`):
  // namespace and default imports carry no imported name, but
  // `Tracked.createContext()` on one is still the real createContext.
  return CONTEXT_MODULES.some((moduleName) =>
    isImportedFromModule(namespaceIdentifier, namespaceIdentifier.name, moduleName),
  );
};

export const isCreateContextCall = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  return isNodeOfType(stripped, "CallExpression") && isCreateContextCallee(stripped.callee);
};
