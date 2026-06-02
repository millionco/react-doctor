import {
  EXPO_UI_LIST_ITEM_COMPONENT,
  EXPO_UI_MODULE_SOURCES,
} from "../../../constants/react-native.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import {
  getImportedNameFromModule,
  isImportedFromModule,
} from "../../../utils/find-import-source-for-name.js";
import { flattenJsxName } from "../../../utils/flatten-jsx-name.js";

// True when `localName` is a named (or renamed) import of `ListItem` from any
// `@expo/ui` entry point — `import { ListItem as Row } from "@expo/ui"` still
// resolves to the canonical `ListItem`.
const isImportedListItemBinding = (contextNode: EsTreeNode, localName: string): boolean => {
  for (const moduleSource of EXPO_UI_MODULE_SOURCES) {
    if (
      getImportedNameFromModule(contextNode, localName, moduleSource) ===
      EXPO_UI_LIST_ITEM_COMPONENT
    ) {
      return true;
    }
  }
  return false;
};

// True when `localName` is a namespace import of any `@expo/ui` entry point,
// covering `import * as ExpoUI from "@expo/ui"` used as `<ExpoUI.ListItem>`.
const isExpoUiNamespaceBinding = (contextNode: EsTreeNode, localName: string): boolean => {
  for (const moduleSource of EXPO_UI_MODULE_SOURCES) {
    if (isImportedFromModule(contextNode, localName, moduleSource)) return true;
  }
  return false;
};

// Universal UI's `<ListItem>` renders raw string children inside the native
// headline text area, and its compound slot markers (`<ListItem.Leading>`,
// `<ListItem.Supporting>`, `<ListItem.Trailing>`) forward strings into native
// text too — so raw text is safe, unlike React Native's core `<View>`. Gated
// on the `@expo/ui` import so a same-named custom `ListItem` in a plain React
// Native app still reports.
//
// Ref: https://docs.expo.dev/versions/v56.0.0/sdk/ui/universal/list/
export const isExpoUiListItemElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  contextNode: EsTreeNode,
): boolean => {
  if (!openingElement.name) return false;
  const dottedName = flattenJsxName(openingElement.name);
  if (!dottedName) return false;

  const [rootLocalName, secondName] = dottedName.split(".");

  // Named import: `<ListItem>` / `<ListItem.Supporting>`.
  if (isImportedListItemBinding(contextNode, rootLocalName)) return true;

  // Namespace import: `<ExpoUI.ListItem>` / `<ExpoUI.ListItem.Supporting>`.
  return (
    secondName === EXPO_UI_LIST_ITEM_COMPONENT &&
    isExpoUiNamespaceBinding(contextNode, rootLocalName)
  );
};
