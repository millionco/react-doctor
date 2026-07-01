import { RECYCLABLE_LIST_PACKAGES } from "../../../constants/react-native.js";
import { getImportedNameFromModule } from "../../../utils/find-import-source-for-name.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";

// Resolve a local JSX name back to the canonical recycler it was really
// imported as (`FlashList`/`LegendList`), following aliased imports
// (`import { FlashList as List }; <List />`). Returns null when the name is not
// a real named import from an owning package, so a homegrown component sharing
// the name never masquerades as the Shopify/Legend recycler.
export const resolveImportedRecyclerName = (node: EsTreeNode, localName: string): string | null => {
  for (const [canonicalName, packageSources] of Object.entries(RECYCLABLE_LIST_PACKAGES)) {
    const isImportedFromOwner = packageSources.some(
      (packageSource) =>
        getImportedNameFromModule(node, localName, packageSource) === canonicalName,
    );
    if (isImportedFromOwner) return canonicalName;
  }
  return null;
};
