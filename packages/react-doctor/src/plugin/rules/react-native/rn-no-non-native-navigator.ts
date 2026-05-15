import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const NON_NATIVE_NAVIGATOR_PACKAGES = new Set([
  "@react-navigation/stack",
  "@react-navigation/drawer",
]);

// HACK: @react-navigation/stack uses a JS-implemented stack with
// imperfect native gesture/feel. native-stack (and native-tabs in v7+)
// uses platform-native UINavigationController / Fragment, giving real
// iOS/Android transitions, swipe-back, and large titles for free.
export const rnNoNonNativeNavigator = defineRule<Rule>({
  id: "rn-no-non-native-navigator",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `@react-navigation/native-stack` (or `native-tabs` in v7+) for platform-native transitions and gestures",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string" || !NON_NATIVE_NAVIGATOR_PACKAGES.has(source)) return;
      const replacement = source.replace("@react-navigation/", "@react-navigation/native-");
      context.report({
        node,
        message: `${source} uses a JS-implemented navigator — use ${replacement} for native iOS/Android transitions and gestures`,
      });
    },
  }),
});
