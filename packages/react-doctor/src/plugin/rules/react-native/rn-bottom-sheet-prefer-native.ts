import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const JS_BOTTOM_SHEET_PACKAGES = new Set([
  "@gorhom/bottom-sheet",
  "react-native-bottom-sheet",
  "react-native-modal-bottom-sheet",
  "react-native-raw-bottom-sheet",
]);

// HACK: JS-implemented bottom sheets (gorhom/bottom-sheet et al.) do all
// their gesture handling and animation on the JS thread, which is laggy
// for the kind of velocity-tracking interactions a bottom sheet needs.
// React Native v7+ ships a native form sheet via <Modal presentationStyle=
// "formSheet"> that handles gestures, snap points, and detents on the
// platform's native modal stack.
export const rnBottomSheetPreferNative = defineRule<Rule>({
  id: "rn-bottom-sheet-prefer-native",
  requires: ["react-native"],
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    'Use `<Modal presentationStyle="formSheet">` (RN v7+) for native gesture handling and snap points',
  examples: [
    {
      before:
        "import BottomSheet from '@gorhom/bottom-sheet';\n<BottomSheet snapPoints={['25%', '50%']} />",
      after: '<Modal presentationStyle="formSheet" visible={visible}>{children}</Modal>',
    },
  ],
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string" || !JS_BOTTOM_SHEET_PACKAGES.has(source)) return;
      context.report({
        node,
        message: `${source} is a JS-implemented bottom sheet — for v7+ RN, prefer <Modal presentationStyle="formSheet"> for native gesture handling and snap points`,
      });
    },
  }),
});
