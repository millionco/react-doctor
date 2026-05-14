import { LEGACY_EXPO_PACKAGE_REPLACEMENTS } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnNoLegacyExpoPackages = defineRule<Rule>({
  id: "rn-no-legacy-expo-packages",
  requires: ["react-native"],
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    "Migrate to the recommended replacement package — legacy Expo packages are no longer maintained",
  examples: [
    {
      before: "import * as Permissions from 'expo-permissions';",
      after: "import * as MediaLibrary from 'expo-media-library';",
    },
  ],
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string") return;

      for (const [packageName, replacement] of LEGACY_EXPO_PACKAGE_REPLACEMENTS) {
        if (source === packageName || source.startsWith(`${packageName}/`)) {
          context.report({
            node,
            message: `"${packageName}" is deprecated — use ${replacement}`,
          });
          return;
        }
      }
    },
  }),
});
