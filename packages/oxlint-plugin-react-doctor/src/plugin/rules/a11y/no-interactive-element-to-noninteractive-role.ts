import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNonInteractiveRole } from "../../utils/is-non-interactive-role.js";
import type { Rule } from "../../utils/rule.js";

const buildMessage = (tag: string, role: string): string =>
  `Screen reader users can't operate this interactive \`<${tag}>\` because role \`${role}\` says it isn't, so remove the role or use a different element.`;

const PRESENTATION_ROLES: ReadonlyArray<string> = ["presentation", "none"];

const DEFAULT_ALLOWED_ROLES: Record<string, ReadonlyArray<string>> = {
  tr: ["none", "presentation"],
  canvas: ["img"],
};

interface NoInteractiveElementToNoninteractiveRoleSettings {
  [tagName: string]: ReadonlyArray<string> | undefined;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Record<string, ReadonlyArray<string>> => {
  const reactDoctor = settings?.["react-doctor"];
  if (typeof reactDoctor !== "object" || reactDoctor === null) return DEFAULT_ALLOWED_ROLES;
  const reactDoctorBlock = reactDoctor as {
    noInteractiveElementToNoninteractiveRole?: NoInteractiveElementToNoninteractiveRoleSettings;
  };
  if (!("noInteractiveElementToNoninteractiveRole" in reactDoctorBlock)) {
    return DEFAULT_ALLOWED_ROLES;
  }
  const ruleSettings = reactDoctorBlock.noInteractiveElementToNoninteractiveRole ?? {};
  // Explicit (possibly empty) override — replaces defaults verbatim.
  const result: Record<string, ReadonlyArray<string>> = {};
  for (const key of Object.keys(ruleSettings)) {
    const value = ruleSettings[key];
    if (Array.isArray(value)) result[key] = value;
  }
  return result;
};

// Port of `oxc_linter::rules::jsx_a11y::no_interactive_element_to_noninteractive_role`.
export const noInteractiveElementToNoninteractiveRole = defineRule<Rule>({
  id: "no-interactive-element-to-noninteractive-role",
  title: "Interactive element given noninteractive role",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Do not give an interactive element a role that says it is not interactive.",
  category: "Accessibility",
  create: (context) => {
    const allowedRoles = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementType = getElementType(node, context.settings);
        if (!HTML_TAGS.has(elementType)) return;
        const isInteractive = elementType === "input" || isInteractiveElement(elementType, node);
        if (!isInteractive) return;

        const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
        if (!roleAttribute) return;
        const value = roleAttribute.value as EsTreeNode | null;
        if (!value || !isNodeOfType(value, "Literal")) return;
        const literal = value as EsTreeNodeOfType<"Literal">;
        if (typeof literal.value !== "string") return;
        const trimmed = literal.value.trim();
        const firstRole = trimmed.split(/\s+/)[0];
        if (!firstRole) return;

        const allowed = allowedRoles[elementType];
        if (allowed && allowed.includes(firstRole)) return;
        if (!isNonInteractiveRole(firstRole) && !PRESENTATION_ROLES.includes(firstRole)) return;
        context.report({
          node: roleAttribute,
          message: buildMessage(elementType, firstRole),
        });
      },
    };
  },
});
