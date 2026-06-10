import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
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

// HACK: TouchableOpacity / TouchableHighlight / TouchableWithoutFeedback /
// TouchableNativeFeedback are legacy and feature-frozen. Pressable is the
// modern, more configurable, more accessible replacement that works the
// same on iOS, Android, and Fabric.
export const rnPreferPressable = defineRule<Rule>({
  id: "rn-prefer-pressable",
  title: "Touchable components instead of Pressable",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `<Pressable>` because Touchable* components are frozen and lack Pressable's state-based feedback and accessibility behavior.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string" || !TOUCHABLE_SOURCES.has(source)) return;
      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        const importedName = getImportedName(specifier);
        if (!importedName || !TOUCHABLE_COMPONENTS.has(importedName)) continue;
        context.report({
          node: specifier,
          message: `Your users miss <Pressable>'s flexible press feedback when you use ${importedName}, which is old & frozen.`,
        });
      }
    },
  }),
});
