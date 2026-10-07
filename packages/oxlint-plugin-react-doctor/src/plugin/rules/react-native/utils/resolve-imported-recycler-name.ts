import { RECYCLABLE_LIST_PACKAGES } from "../../../constants/react-native.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveImportedJsxComponentName } from "../../../utils/resolve-imported-jsx-component-name.js";

interface ResolveImportedRecyclerNameOptions {
  // Also resolve `<FL.FlashList />` when `FL` is a namespace import from an
  // owning package. Opt-in because rn-list-missing-estimated-item-size pins
  // the namespace-member miss as an accepted tradeoff.
  allowNamespaceMemberAccess?: boolean;
}

// Resolve a local JSX name back to the canonical recycler it was really
// imported as (`FlashList`/`LegendList`), following aliased imports
// (`import { FlashList as List }; <List />`) and — when
// `allowNamespaceMemberAccess` is set — namespace member access
// (`import * as FL from "@shopify/flash-list"; <FL.FlashList />`). Returns
// null when the name is not backed by a real import from an owning package,
// so a homegrown component sharing the name never masquerades as the
// Shopify/Legend recycler.
export const resolveImportedRecyclerName = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
  options?: ResolveImportedRecyclerNameOptions,
): string | null => {
  if (isNodeOfType(node.name, "JSXMemberExpression") && !options?.allowNamespaceMemberAccess) {
    return null;
  }
  for (const [canonicalName, packageSources] of Object.entries(RECYCLABLE_LIST_PACKAGES)) {
    for (const packageSource of packageSources) {
      if (resolveImportedJsxComponentName(node, packageSource, scopes) === canonicalName) {
        return canonicalName;
      }
    }
  }
  return null;
};
