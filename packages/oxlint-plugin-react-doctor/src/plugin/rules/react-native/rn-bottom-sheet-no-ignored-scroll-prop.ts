import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveImportedJsxComponentName } from "../../utils/resolve-imported-jsx-component-name.js";

const GORHOM_BOTTOM_SHEET_MODULE = "@gorhom/bottom-sheet";
const IGNORED_SCROLL_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "decelerationRate",
  "onScrollBeginDrag",
  "scrollEventThrottle",
]);

export const rnBottomSheetNoIgnoredScrollProp = defineRule({
  id: "rn-bottom-sheet-no-ignored-scroll-prop",
  title: "Ignored BottomSheetScrollView prop",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Remove scrollEventThrottle, decelerationRate, and onScrollBeginDrag from BottomSheetScrollView because the component ignores them.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const componentName = resolveImportedJsxComponentName(
        node,
        GORHOM_BOTTOM_SHEET_MODULE,
        context.scopes,
      );
      if (componentName !== "BottomSheetScrollView") return;
      for (const attribute of node.attributes) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        const propertyName = getJsxAttributeName(attribute.name);
        if (!propertyName || !IGNORED_SCROLL_PROPERTY_NAMES.has(propertyName)) continue;
        context.report({
          node: attribute,
          message: `BottomSheetScrollView ignores \`${propertyName}\`, so this prop cannot affect scrolling. Remove it or handle the behavior outside the scrollable.`,
        });
      }
    },
  }),
});
