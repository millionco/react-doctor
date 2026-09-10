import { defineRule } from "../../utils/define-rule.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const JS_THREAD_ANIMATION_IMPORTS = new Set(["Animated", "LayoutAnimation"]);

export const rnPreferReanimated = defineRule({
  id: "rn-prefer-reanimated",
  title: "JS-thread animation instead of Reanimated",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use Reanimated for always-native animations (`import Animated from 'react-native-reanimated'`), or ensure every Animated.timing/spring/decay has `useNativeDriver: true` for native-thread execution.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value !== "react-native") return;
      if (isTypeOnlyImport(node)) return;

      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        if (specifier.importKind === "type") continue;
        const importedName = getImportedName(specifier);
        if (!importedName || !JS_THREAD_ANIMATION_IMPORTS.has(importedName)) continue;

        const message =
          importedName === "LayoutAnimation"
            ? "LayoutAnimation from react-native may cause stutter when it runs on the JS thread."
            : "Animated from react-native may cause stutter when animations run on the JS thread without `useNativeDriver: true`.";

        context.report({
          node: specifier,
          message,
        });
      }
    },
  }),
});
