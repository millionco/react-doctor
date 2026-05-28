import { DEPRECATED_RN_MODULE_REPLACEMENTS } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isExpoManagedFileActive } from "../../utils/is-expo-managed-file.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const getExpoAwareReplacement = (
  importedName: string,
  baseReplacement: string,
  isExpo: boolean,
): string => {
  if (!isExpo) return baseReplacement;
  if (importedName === "AsyncStorage")
    return 'expo-sqlite/localStorage (import "expo-sqlite/localStorage/install") for simple key-value storage, or expo-secure-store for sensitive data';
  return baseReplacement;
};

export const rnNoDeprecatedModules = defineRule<Rule>({
  id: "rn-no-deprecated-modules",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "error",
  recommendation:
    "Import from the community package instead — deprecated modules were removed from the react-native core",
  create: (context: RuleContext) => {
    const isExpo = isExpoManagedFileActive(context);

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (node.source?.value !== "react-native") return;

        for (const specifier of node.specifiers ?? []) {
          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          const importedName = getImportedName(specifier);
          if (!importedName) continue;

          const baseReplacement = DEPRECATED_RN_MODULE_REPLACEMENTS.get(importedName);
          if (!baseReplacement) continue;

          const replacement = getExpoAwareReplacement(importedName, baseReplacement, isExpo);
          context.report({
            node: specifier,
            message: `"${importedName}" was removed from react-native — use ${replacement} instead`,
          });
        }
      },
    };
  },
});
