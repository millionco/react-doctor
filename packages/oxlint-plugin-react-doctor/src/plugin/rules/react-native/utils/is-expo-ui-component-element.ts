import { EXPO_UI_MODULE_SOURCES } from "../../../constants/react-native.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../../utils/find-import-source-for-name.js";
import { flattenJsxName } from "../../../utils/flatten-jsx-name.js";

// True when `localName` is a named (or renamed) import of `componentName` from
// any `@expo/ui` entry point — `import { ListItem as Row } from "@expo/ui"`
// still resolves to the canonical `ListItem`.
const isNamedImportOf = (
  contextNode: EsTreeNode,
  localName: string,
  componentName: string,
): boolean => {
  for (const moduleSource of EXPO_UI_MODULE_SOURCES) {
    if (getImportedNameFromModule(contextNode, localName, moduleSource) === componentName) {
      return true;
    }
  }
  return false;
};

// True when `localName` is a namespace import (`import * as ExpoUI`) of any
// `@expo/ui` entry point, covering `<ExpoUI.ListItem>`. Deliberately excludes
// named/default imports so a named `@expo/ui` import reused via member access
// (`<Row.ListItem>`) is not mistaken for the namespace form.
const isExpoUiNamespaceImport = (contextNode: EsTreeNode, localName: string): boolean => {
  for (const moduleSource of EXPO_UI_MODULE_SOURCES) {
    if (isNamespaceImportFromModule(contextNode, localName, moduleSource)) return true;
  }
  return false;
};

// True when the JSX element resolves to `componentName` exported from any
// `@expo/ui` entry point — covering `<ListItem>`, member-access slot markers
// (`<ListItem.Supporting>`), and namespace access (`<ExpoUI.ListItem>`).
//
// Universal UI is a native UI layer (delegating to SwiftUI / Jetpack Compose),
// not React Native's core primitives, so several RN-core assumptions don't
// hold for these components: `<ListItem>` auto-wraps raw string children in
// native text, and its `<ScrollView>` can't be swapped for `FlatList`. Rules
// gate on this to stay quiet for `@expo/ui` while still firing on same-named
// components from other libraries (or with no import).
//
// Ref: https://docs.expo.dev/versions/v56.0.0/sdk/ui/universal/
export const isExpoUiComponentElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  contextNode: EsTreeNode,
  componentName: string,
): boolean => {
  if (!openingElement.name) return false;
  const dottedName = flattenJsxName(openingElement.name);
  if (!dottedName) return false;

  const [rootLocalName, secondName] = dottedName.split(".");

  // Named import: `<ListItem>` / `<ListItem.Supporting>`.
  if (isNamedImportOf(contextNode, rootLocalName, componentName)) return true;

  // Namespace import: `<ExpoUI.ListItem>` / `<ExpoUI.ListItem.Supporting>`.
  return secondName === componentName && isExpoUiNamespaceImport(contextNode, rootLocalName);
};
