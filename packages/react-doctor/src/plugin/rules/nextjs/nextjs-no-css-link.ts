import { GOOGLE_FONTS_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoCssLink = defineRule<Rule>({
  id: "nextjs-no-css-link",
  requires: ["nextjs"],
  framework: "nextjs",
  severity: "warn",
  category: "Next.js",
  recommendation:
    "Import CSS directly: `import './styles.css'` or use CSS Modules: `import styles from './Button.module.css'`",
  examples: [
    {
      before: '<link rel="stylesheet" href="/styles/main.css" />',
      after: "import './styles/main.css';",
    },
  ],
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "link") return;
      const attributes = node.attributes ?? [];

      const relAttribute = findJsxAttribute(attributes, "rel");
      if (!relAttribute?.value) return;
      const relValue = isNodeOfType(relAttribute.value, "Literal")
        ? relAttribute.value.value
        : null;
      if (relValue !== "stylesheet") return;

      const hrefAttribute = findJsxAttribute(attributes, "href");
      if (!hrefAttribute?.value) return;
      const hrefValue = isNodeOfType(hrefAttribute.value, "Literal")
        ? hrefAttribute.value.value
        : null;
      if (typeof hrefValue === "string" && GOOGLE_FONTS_PATTERN.test(hrefValue)) return;

      context.report({
        node,
        message: '<link rel="stylesheet"> tag — import CSS directly for bundling and optimization',
      });
    },
  }),
});
