import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isDirectNamedReactHookCall = (
  hook: EsTreeNode | null | undefined,
  api: "useCallback" | "useEffect" | "useMemo" | "useRef" | "useState",
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(hook, "CallExpression") ||
    hook.optional ||
    !isNodeOfType(hook.callee, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(hook.callee);
  const specifier = symbol?.declarationNode;
  const imported = specifier?.parent;
  return Boolean(
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(specifier.imported, "Identifier") &&
    specifier.imported.name === api &&
    isNodeOfType(imported, "ImportDeclaration") &&
    imported.importKind !== "type" &&
    imported.source.value === "react" &&
    imported.parent === scopes.rootScope.node &&
    symbol === scopes.symbolFor(specifier.local),
  );
};
