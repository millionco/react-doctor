import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: react-native's built-in <Image> has no caching, no placeholders,
// no progressive loading, and no priority hints. expo-image is a drop-in
// replacement (same prop API plus more) with disk + memory caching, blur
// placeholders, and crossfades — a major perceived-perf win for any list
// or hero image.
export const rnPreferExpoImage = defineRule<Rule>({
  id: "rn-prefer-expo-image",
  requires: ["react-native"],
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    "Use `<Image>` from `expo-image` instead of `react-native` — same prop API, plus disk + memory caching, placeholders, and crossfades",
  examples: [
    {
      before: "import { Image } from 'react-native';\n<Image source={{ uri }} />",
      after: "import { Image } from 'expo-image';\n<Image source={{ uri }} />",
    },
  ],
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value !== "react-native") return;
      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        if (getImportedName(specifier) !== "Image") continue;
        context.report({
          node: specifier,
          message:
            "Importing Image from react-native — prefer expo-image for caching, placeholders, and progressive loading (drop-in API)",
        });
      }
    },
  }),
});
