import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getReactDoctorRuleSettings } from "../../utils/get-react-doctor-setting.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import type { Rule } from "../../utils/rule.js";
import { getElementImplicitRoles } from "../../constants/aria-element-roles.js";

interface NoRedundantRolesSettings {
  // Per-element overrides: a tag can specify additional non-redundant
  // roles (e.g. `nav: ["navigation"]` flags `<nav role="navigation">`).
  // The OXC port supports user-provided overrides.
  exceptions?: Readonly<Record<string, ReadonlyArray<string>>>;
}

const buildMessage = (tag: string, role: string): string =>
  `\`<${tag}>\` already has implicit role \`${role}\` — remove the redundant \`role\` attribute.`;

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoRedundantRolesSettings> => {
  const ruleSettings = getReactDoctorRuleSettings<NoRedundantRolesSettings>(
    settings,
    "noRedundantRoles",
  );
  return { exceptions: ruleSettings.exceptions ?? {} };
};

// Port of `oxc_linter::rules::jsx_a11y::no_redundant_roles`. Reports a
// `role` attribute that matches the element's implicit role.
export const noRedundantRoles = defineRule<Rule>({
  id: "no-redundant-roles",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Remove `role` attributes that match the element's implicit role.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const roleAttr = hasJsxPropIgnoreCase(node.attributes, "role");
        if (!roleAttr) return;
        const role = getJsxPropStringValue(roleAttr);
        if (role === null) return;
        const tag = getElementType(node, context.settings);
        const implicitRoles = getElementImplicitRoles(tag);
        const allowedHere = settings.exceptions[tag] ?? [];
        if (implicitRoles.includes(role) && !allowedHere.includes(role)) {
          context.report({ node: roleAttr, message: buildMessage(tag, role) });
        }
      },
    };
  },
});
