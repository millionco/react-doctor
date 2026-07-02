import { RECYCLABLE_LIST_PACKAGES } from "../../../constants/react-native.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../../utils/find-import-source-for-name.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

interface ResolveImportedRecyclerNameOptions {
  // Also resolve `<FL.FlashList />` when `FL` is a namespace import from an
  // owning package. Opt-in because rn-list-missing-estimated-item-size pins
  // the namespace-member miss as an accepted tradeoff.
  allowNamespaceMemberAccess?: boolean;
}

const getJsxMemberObjectName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "JSXOpeningElement")) return null;
  const elementName = node.name;
  if (!elementName || !isNodeOfType(elementName, "JSXMemberExpression")) return null;
  return isNodeOfType(elementName.object, "JSXIdentifier") ? elementName.object.name : null;
};

// Resolve a local JSX name back to the canonical recycler it was really
// imported as (`FlashList`/`LegendList`), following aliased imports
// (`import { FlashList as List }; <List />`) and — when
// `allowNamespaceMemberAccess` is set — namespace member access
// (`import * as FL from "@shopify/flash-list"; <FL.FlashList />`). Returns
// null when the name is not backed by a real import from an owning package,
// so a homegrown component sharing the name never masquerades as the
// Shopify/Legend recycler.
export const resolveImportedRecyclerName = (
  node: EsTreeNode,
  localName: string,
  options?: ResolveImportedRecyclerNameOptions,
): string | null => {
  const jsxMemberObjectName = options?.allowNamespaceMemberAccess
    ? getJsxMemberObjectName(node)
    : null;
  for (const [canonicalName, packageSources] of Object.entries(RECYCLABLE_LIST_PACKAGES)) {
    if (jsxMemberObjectName !== null) {
      const isNamespaceMemberOfOwner =
        localName === canonicalName &&
        packageSources.some((packageSource) =>
          isNamespaceImportFromModule(node, jsxMemberObjectName, packageSource),
        );
      if (isNamespaceMemberOfOwner) return canonicalName;
      continue;
    }
    const isImportedFromOwner = packageSources.some(
      (packageSource) =>
        getImportedNameFromModule(node, localName, packageSource) === canonicalName,
    );
    if (isImportedFromOwner) return canonicalName;
  }
  return null;
};
