import { DEPRECATED_RN_MODULE_REPLACEMENTS } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnNoDeprecatedModules = defineRule<Rule>({
  requires: ["react-native"],
  framework: "react-native",
  severity: "error",
  category: "React Native",
  recommendation:
    "Import from the community package instead — deprecated modules were removed from the react-native core",
  examples: [
    {
      before: "import { AsyncStorage } from 'react-native';",
      after: "import AsyncStorage from '@react-native-async-storage/async-storage';",
    },
  ],
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value !== "react-native") return;

      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        const importedName = getImportedName(specifier);
        if (!importedName) continue;

        const replacement = DEPRECATED_RN_MODULE_REPLACEMENTS.get(importedName);
        if (!replacement) continue;

        context.report({
          node: specifier,
          message: `"${importedName}" was removed from react-native — use ${replacement} instead`,
        });
      }
    },
  }),
});
