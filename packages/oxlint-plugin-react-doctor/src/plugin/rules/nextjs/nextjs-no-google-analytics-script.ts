import { GOOGLE_ANALYTICS_SCRIPT_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoGoogleAnalyticsScript = defineRule<Rule>({
  id: "nextjs-no-google-analytics-script",
  title: "Manual Google Analytics script blocks optimized loading",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Use `import { GoogleAnalytics } from '@next/third-parties/google'` for automatic optimization and smaller bundles.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier")) return;
      if (node.name.name !== "script" && node.name.name !== "Script") return;

      const srcAttribute = findJsxAttribute(node.attributes ?? [], "src");
      if (!srcAttribute?.value) return;

      const srcValue = isNodeOfType(srcAttribute.value, "Literal")
        ? srcAttribute.value.value
        : null;

      if (typeof srcValue === "string" && GOOGLE_ANALYTICS_SCRIPT_PATTERN.test(srcValue)) {
        context.report({
          node,
          message:
            "Manual Google Analytics scripts block rendering without Next.js' optimized loading strategy.",
        });
      }
    },
  }),
});
