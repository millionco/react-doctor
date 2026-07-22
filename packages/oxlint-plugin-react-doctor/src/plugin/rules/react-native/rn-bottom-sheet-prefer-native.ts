import { defineRule } from "../../utils/define-rule.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const JS_BOTTOM_SHEET_PACKAGES = new Set([
  "react-native-bottom-sheet",
  "react-native-modal-bottom-sheet",
  "react-native-raw-bottom-sheet",
  "react-native-modalize",
  "react-native-actions-sheet",
  "react-native-bottomsheet-reanimated",
  "@discord/bottom-sheet",
]);

export const rnBottomSheetPreferNative = defineRule({
  id: "rn-bottom-sheet-prefer-native",
  title: "JS bottom sheet misses native sheet behavior",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    'When native presentation fits the design, use `<Modal presentationStyle="formSheet">` for platform-native gestures, accessibility, and presentation behavior.',
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string" || !JS_BOTTOM_SHEET_PACKAGES.has(source)) return;
      if (isTypeOnlyImport(node)) return;
      context.report({
        node,
        message: `Users get JS-driven sheet gestures and presentation with ${source}, instead of the platform-native formSheet behavior.`,
      });
    },
  }),
});
