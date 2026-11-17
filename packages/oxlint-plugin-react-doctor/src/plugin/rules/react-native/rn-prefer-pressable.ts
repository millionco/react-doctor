import { defineRule } from "../../utils/define-rule.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const TOUCHABLE_COMPONENTS = new Set([
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "TouchableNativeFeedback",
]);

const TOUCHABLE_SOURCES = new Set(["react-native", "react-native-gesture-handler"]);

export const rnPreferPressable = defineRule({
  id: "rn-prefer-pressable",
  defaultEnabled: false,
  title: "Touchable components instead of Pressable",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Consider `Pressable` only when press feedback, callbacks, gestures, accessibility, and layout can be preserved; otherwise keep the existing Touchable.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string" || !TOUCHABLE_SOURCES.has(source)) return;
      if (isTypeOnlyImport(node)) return;
      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        if (specifier.importKind === "type") continue;
        const importedName = getImportedName(specifier);
        if (!importedName || !TOUCHABLE_COMPONENTS.has(importedName)) continue;
        context.report({
          node: specifier,
          message: `This value import of ${importedName} is a candidate for Pressable migration. Confirm that interaction and accessibility behavior can be preserved.`,
        });
      }
    },
  }),
});
