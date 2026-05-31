import { LEGACY_EXPO_PACKAGE_REPLACEMENTS } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnNoLegacyExpoPackages = defineRule<Rule>({
  id: "rn-no-legacy-expo-packages",
  title: "Unmaintained legacy Expo package",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "These Expo packages are no longer maintained. Switch to the recommended replacement package.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string") return;

      for (const [packageName] of LEGACY_EXPO_PACKAGE_REPLACEMENTS) {
        if (source === packageName || source.startsWith(`${packageName}/`)) {
          context.report({
            node,
            message: `Your users are exposed to unfixed bugs when "${packageName}" is no longer maintained.`,
          });
          return;
        }
      }
    },
  }),
});
