import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

const PLACEHOLDER_PERSONA_PATTERN = /\b(?:example user|jane doe|john smith)\b/i;

export const noPlaceholderPersonaCopy = defineRule({
  id: "no-placeholder-persona-copy",
  title: "Page renders a placeholder persona",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use realistic, context-specific sample content or clearly label the surface as a demo instead of shipping generic placeholder identities.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node)) return;
      const matchedPersona = getStaticJsxText(node).match(PLACEHOLDER_PERSONA_PATTERN)?.[0];
      if (!matchedPersona) return;
      context.report({
        node: node.openingElement,
        message: `“${matchedPersona}” reads like unfinished demo content. Replace it with context-specific sample data or an explicit demo label.`,
      });
    },
  }),
});
