import { LEGACY_EXPO_PACKAGE_REPLACEMENTS } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnNoLegacyExpoPackages = defineRule({
  id: "rn-no-legacy-expo-packages",
  title: "Unmaintained legacy Expo package",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Switch to the maintained replacement package so users are not stuck with unfixed bugs in deprecated Expo packages.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string") return;
      if (isTypeOnlyImport(node)) return;

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
