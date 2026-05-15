import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnPreferReanimated = defineRule<Rule>({
  id: "rn-prefer-reanimated",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `import Animated from 'react-native-reanimated'` — animations run on the UI thread instead of the JS thread",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value !== "react-native") return;

      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        if (getImportedName(specifier) !== "Animated") continue;

        context.report({
          node: specifier,
          message:
            "Animated from react-native runs animations on the JS thread — use react-native-reanimated for performant UI-thread animations",
        });
      }
    },
  }),
});
