import { DEPRECATED_RN_MODULE_REPLACEMENTS } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnNoDeprecatedModules = defineRule<Rule>({
  id: "rn-no-deprecated-modules",
  title: "Module removed from react-native core",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "error",
  recommendation:
    "These modules were removed from react-native core. Import them from the community package instead.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value !== "react-native") return;

      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        const importedName = getImportedName(specifier);
        if (!importedName) continue;

        const baseReplacement = DEPRECATED_RN_MODULE_REPLACEMENTS.get(importedName);
        if (!baseReplacement) continue;

        context.report({
          node: specifier,
          message: `Your users hit a crash from "${importedName}", which was removed from react-native.`,
        });
      }
    },
  }),
});
