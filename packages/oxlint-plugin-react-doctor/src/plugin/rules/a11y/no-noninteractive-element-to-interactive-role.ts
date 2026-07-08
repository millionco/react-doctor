import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNonInteractiveElement } from "../../utils/is-non-interactive-element.js";

const buildMessage = (tag: string, role: string): string =>
  `Role \`${role}\` gives \`<${tag}>\` interactive semantics even though the element is noninteractive, so screen reader users get the wrong controls.`;

// Mirrors the upstream `eslint-plugin-jsx-a11y` recommended config for
// this rule, plus `nav → tablist` (permitted by ARIA in HTML and the
// standard tabs pattern).
const DEFAULT_ALLOWED_ROLES: Record<string, ReadonlyArray<string>> = {
  ul: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"],
  ol: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid"],
  li: ["menuitem", "menuitemcheckbox", "menuitemradio", "option", "row", "tab", "treeitem"],
  table: ["grid"],
  td: ["gridcell"],
  nav: ["tablist"],
  fieldset: ["radiogroup", "presentation"],
};

interface NoNoninteractiveElementToInteractiveRoleSettings {
  // Element → list of allowed roles. Overrides the default table.
  [tagName: string]: ReadonlyArray<string> | undefined;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Record<string, ReadonlyArray<string>> => {
  const reactDoctor = settings?.["react-doctor"];
  if (typeof reactDoctor !== "object" || reactDoctor === null) return DEFAULT_ALLOWED_ROLES;
  const reactDoctorBlock = reactDoctor as {
    noNoninteractiveElementToInteractiveRole?: NoNoninteractiveElementToInteractiveRoleSettings;
  };
  if (!("noNoninteractiveElementToInteractiveRole" in reactDoctorBlock)) {
    return DEFAULT_ALLOWED_ROLES;
  }
  const ruleSettings = reactDoctorBlock.noNoninteractiveElementToInteractiveRole ?? {};
  // Explicit (possibly empty) override — replaces defaults verbatim.
  const result: Record<string, ReadonlyArray<string>> = {};
  for (const key of Object.keys(ruleSettings)) {
    const value = ruleSettings[key];
    if (Array.isArray(value)) result[key] = value;
  }
  return result;
};

// Port of `oxc_linter::rules::jsx_a11y::no_noninteractive_element_to_interactive_role`.
export const noNoninteractiveElementToInteractiveRole = defineRule({
  id: "no-noninteractive-element-to-interactive-role",
  title: "Noninteractive element given interactive role",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Use a real interactive element instead of adding an interactive role to a static one.",
  category: "Accessibility",
  create: (context) => {
    const allowedRoles = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
        if (!roleAttribute) return;
        const value = roleAttribute.value as EsTreeNode | null;
        if (!value || !isNodeOfType(value, "Literal") || typeof value.value !== "string") {
          return;
        }
        const trimmed = value.value.trim();
        const firstRole = trimmed.split(/\s+/)[0];
        if (!firstRole) return;

        const elementType = getElementType(node, context.settings);
        if (!HTML_TAGS.has(elementType)) return;

        const allowed = allowedRoles[elementType];
        if (allowed && allowed.includes(firstRole)) return;
        if (!isNonInteractiveElement(elementType, node)) return;
        if (!isInteractiveRole(firstRole)) return;
        // A separator is only a widget when focusable; the non-focusable
        // form is static structure (ARIA window-splitter pattern).
        if (firstRole === "separator" && !hasJsxPropIgnoreCase(node.attributes, "tabindex")) {
          return;
        }
        context.report({
          node: roleAttribute,
          message: buildMessage(elementType, firstRole),
        });
      },
    };
  },
});
