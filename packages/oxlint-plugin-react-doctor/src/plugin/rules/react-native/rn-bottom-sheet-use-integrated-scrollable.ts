import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { resolveImportedJsxComponentName } from "../../utils/resolve-imported-jsx-component-name.js";

const GORHOM_BOTTOM_SHEET_MODULE = "@gorhom/bottom-sheet";
const REACT_NATIVE_MODULE = "react-native";
const BOTTOM_SHEET_CONTAINER_NAMES: ReadonlySet<string> = new Set([
  "BottomSheet",
  "BottomSheetModal",
  "default",
]);
const REACT_NATIVE_SCROLLABLE_NAMES: ReadonlySet<string> = new Set([
  "FlatList",
  "ScrollView",
  "SectionList",
  "VirtualizedList",
]);

export const rnBottomSheetUseIntegratedScrollable = defineRule({
  id: "rn-bottom-sheet-use-integrated-scrollable",
  title: "React Native scrollable inside a Bottom Sheet",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use @gorhom/bottom-sheet's integrated BottomSheetScrollView, BottomSheetFlatList, BottomSheetSectionList, or BottomSheetVirtualizedList so gestures coordinate with the sheet.",
  create: (context) => {
    const reportedScrollables = new WeakSet<EsTreeNode>();
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        const containerName = resolveImportedJsxComponentName(
          node.openingElement,
          GORHOM_BOTTOM_SHEET_MODULE,
          context.scopes,
        );
        if (!containerName || !BOTTOM_SHEET_CONTAINER_NAMES.has(containerName)) return;
        for (const descendant of getStaticJsxDescendantOpeningElements(node, {
          includeStaticExpressionBranches: true,
        })) {
          if (reportedScrollables.has(descendant)) continue;
          const scrollableName = resolveImportedJsxComponentName(
            descendant,
            REACT_NATIVE_MODULE,
            context.scopes,
          );
          if (!scrollableName || !REACT_NATIVE_SCROLLABLE_NAMES.has(scrollableName)) continue;
          reportedScrollables.add(descendant);
          context.report({
            node: descendant,
            message: `React Native's \`${scrollableName}\` does not coordinate gestures with this Bottom Sheet. Use \`BottomSheet${scrollableName}\` from @gorhom/bottom-sheet.`,
          });
        }
      },
    };
  },
});
