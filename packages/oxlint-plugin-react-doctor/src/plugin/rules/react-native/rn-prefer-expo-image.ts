import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isExpoManagedFileActive } from "../../utils/is-expo-managed-file.js";

const EMPTY_VISITORS: RuleVisitors = {};

// HACK: react-native's built-in <Image> has no caching, no placeholders,
// no progressive loading, and no priority hints. expo-image is a drop-in
// replacement (same prop API plus more) with disk + memory caching, blur
// placeholders, and crossfades — a major perceived-perf win for any list
// or hero image.
export const rnPreferExpoImage = defineRule<Rule>({
  id: "rn-prefer-expo-image",
  title: "react-native Image instead of expo-image",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `<Image>` from `expo-image` instead of `react-native`. Same props, plus caching, placeholders, and crossfades for faster image loading.",
  create: (context: RuleContext) => {
    if (!isExpoManagedFileActive(context)) return EMPTY_VISITORS;

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const source = node.source?.value;

        if (source !== "react-native") return;
        for (const specifier of node.specifiers ?? []) {
          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          const importedName = getImportedName(specifier);
          if (importedName !== "Image" && importedName !== "ImageBackground") continue;
          context.report({
            node: specifier,
            message: `Your users watch images reload often because ${importedName} from react-native has no caching.`,
          });
        }
      },
    };
  },
});
