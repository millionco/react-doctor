import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
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

export const rnBottomSheetPreferNative = defineRule<Rule>({
  id: "rn-bottom-sheet-prefer-native",
  title: "JS bottom sheet misses native sheet behavior",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    'On RN v7+, use `<Modal presentationStyle="formSheet">` so the sheet uses platform-native gestures, detents, accessibility, and presentation behavior.',
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string" || !JS_BOTTOM_SHEET_PACKAGES.has(source)) return;
      context.report({
        node,
        message: `Users get JS-driven sheet gestures and presentation with ${source}, instead of the platform-native formSheet behavior.`,
      });
    },
  }),
});
