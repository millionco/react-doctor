import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import type { Rule } from "../../utils/rule.js";
import { getTagsForRole } from "../../constants/aria-element-roles.js";

const buildMessage = (role: string, tag: string): string =>
  `Screen reader users get more reliable semantics from \`<${tag}>\` than \`role="${role}"\`, so use \`<${tag}>\` instead.`;

// Port of `oxc_linter::rules::jsx_a11y::prefer_tag_over_role`. When a
// generic element (`div`/`span`) uses `role` to emulate a built-in
// element's semantics, suggest using the built-in directly.
export const preferTagOverRole = defineRule<Rule>({
  id: "prefer-tag-over-role",
  title: "Role used instead of HTML tag",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Replace `role` with the matching HTML element when one exists.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tag = getElementType(node, context.settings);
      if (tag !== "div" && tag !== "span") return;
      const roleAttr = hasJsxPropIgnoreCase(node.attributes, "role");
      if (!roleAttr) return;
      const role = getJsxPropStringValue(roleAttr);
      if (!role) return;
      const matchingTags = getTagsForRole(role);
      if (matchingTags.length === 0) return;
      const preferred = matchingTags[0]!;
      context.report({ node: roleAttr, message: buildMessage(role, preferred) });
    },
  }),
});
