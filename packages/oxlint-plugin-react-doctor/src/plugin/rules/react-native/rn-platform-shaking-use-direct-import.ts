import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNamespaceImportFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const REACT_NATIVE_MODULE_SOURCE = "react-native";

export const rnPlatformShakingUseDirectImport = defineRule({
  id: "rn-platform-shaking-use-direct-import",
  title: "Platform reached through React Native namespace",
  tags: ["test-noise"],
  requires: ["expo:54"],
  severity: "warn",
  recommendation:
    'Import `Platform` directly with `import { Platform } from "react-native"` so Expo can remove code for the other platform.',
  create: (context: RuleContext) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      if (node.computed) return;
      if (!isNodeOfType(node.object, "Identifier")) return;
      if (!isNodeOfType(node.property, "Identifier") || node.property.name !== "Platform") return;
      if (context.scopes.symbolFor(node.object)?.kind !== "import") return;
      if (!isNamespaceImportFromModule(node, node.object.name, REACT_NATIVE_MODULE_SOURCE)) return;
      context.report({
        node,
        message:
          "Expo cannot tree-shake platform branches reached through the React Native namespace, so both platform paths stay in the bundle.",
      });
    },
  }),
});
