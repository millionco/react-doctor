import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { SCROLLVIEW_NAMES } from "./utils/scrollview_names.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: <SafeAreaView> wrapping <ScrollView> (or
// `useSafeAreaInsets()` + `paddingTop: insets.top` in
// `contentContainerStyle`) is the legacy way to handle safe areas.
// Modern RN exposes `contentInsetAdjustmentBehavior="automatic"` which
// the OS computes natively, integrating with sticky headers, large
// titles, and keyboard avoidance for free.
export const rnPreferContentInsetAdjustment = defineRule<Rule>({
  id: "rn-prefer-content-inset-adjustment",
  title: "SafeAreaView instead of contentInsetAdjustment",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    'Drop the SafeAreaView wrapper and set `contentInsetAdjustmentBehavior="automatic"` on the ScrollView so the OS handles the safe area.',
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const elementName = resolveJsxElementName(node.openingElement);
      if (elementName !== "SafeAreaView") return;

      for (const child of node.children ?? []) {
        if (!isNodeOfType(child, "JSXElement")) continue;
        const childName = resolveJsxElementName(child.openingElement);
        if (!childName || !SCROLLVIEW_NAMES.has(childName)) continue;
        if (childName === "KeyboardAwareScrollView") continue;

        context.report({
          node,
          message: `Your users render an extra wrapper view from <SafeAreaView> around <${childName}>.`,
        });
        return;
      }
    },
  }),
});
