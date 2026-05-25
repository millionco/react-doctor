import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const JS_BOTTOM_SHEET_PACKAGES = new Set([
  "react-native-bottom-sheet",
  "react-native-modal-bottom-sheet",
  "react-native-raw-bottom-sheet",
]);

export const rnBottomSheetPreferNative = defineRule<Rule>({
  id: "rn-bottom-sheet-prefer-native",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    'Use `<Modal presentationStyle="formSheet">` only for iOS form-sheet flows; it is not a general cross-platform bottom-sheet replacement',
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string" || !JS_BOTTOM_SHEET_PACKAGES.has(source)) return;
      context.report({
        node,
        message: `${source} is a JS-implemented bottom sheet — <Modal presentationStyle="formSheet"> is iOS-only and best for form-sheet flows, not a general cross-platform bottom-sheet replacement`,
      });
    },
  }),
});
