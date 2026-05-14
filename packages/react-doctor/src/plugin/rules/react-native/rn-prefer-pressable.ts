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

// HACK: TouchableOpacity / TouchableHighlight / TouchableWithoutFeedback /
// TouchableNativeFeedback are legacy and feature-frozen. Pressable is the
// modern, more configurable, more accessible replacement that works the
// same on iOS, Android, and Fabric.
export const rnPreferPressable = defineRule<Rule>({
  id: "rn-prefer-pressable",
  requires: ["react-native"],
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    "Use `<Pressable>` from react-native (or react-native-gesture-handler) instead of legacy Touchable* components",
  examples: [
    {
      before: "<TouchableOpacity onPress={onPress}><Text>Tap</Text></TouchableOpacity>",
      after: "<Pressable onPress={onPress}><Text>Tap</Text></Pressable>",
    },
  ],
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value !== "react-native") return;
      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        const importedName = getImportedName(specifier);
        if (!importedName || !TOUCHABLE_COMPONENTS.has(importedName)) continue;
        context.report({
          node: specifier,
          message: `${importedName} is legacy — use <Pressable> from react-native (or react-native-gesture-handler) for modern press handling`,
        });
      }
    },
  }),
});
