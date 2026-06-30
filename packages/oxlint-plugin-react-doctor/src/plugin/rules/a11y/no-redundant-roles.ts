import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { getElementImplicitRoles } from "../../constants/aria-element-roles.js";

interface NoRedundantRolesSettings {
  // Per-element overrides: a tag can specify additional non-redundant
  // roles (e.g. `nav: ["navigation"]` flags `<nav role="navigation">`).
  // The OXC port supports user-provided overrides.
  exceptions?: Readonly<Record<string, ReadonlyArray<string>>>;
}

const buildMessage = (tag: string, role: string): string =>
  `Screen reader users gain nothing from this \`role\` because \`<${tag}>\` already acts as a \`${role}\`, so remove it.`;

// `<ul role="list">` / `<ol role="list">` is the deliberate Safari +
// VoiceOver workaround: `list-style: none` makes WebKit silently drop list
// semantics, and the explicit role restores them. It is an intentional
// a11y-preserving idiom, not redundant noise, so it is exempt by default
// (users can still narrow further via the `exceptions` setting).
const DEFAULT_NON_REDUNDANT_ROLES: Readonly<Record<string, ReadonlyArray<string>>> = {
  ul: ["list"],
  ol: ["list"],
};

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoRedundantRolesSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noRedundantRoles?: NoRedundantRolesSettings }).noRedundantRoles ?? {})
      : {};
  return { exceptions: ruleSettings.exceptions ?? {} };
};

// Port of `oxc_linter::rules::jsx_a11y::no_redundant_roles`. Reports a
// `role` attribute that matches the element's implicit role.
export const noRedundantRoles = defineRule({
  id: "no-redundant-roles",
  title: "Redundant ARIA role",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Remove redundant `role` attributes so assistive tech reads the element's native semantics without extra noise.",
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
        const allowedHere = [
          ...(DEFAULT_NON_REDUNDANT_ROLES[tag] ?? []),
          ...(settings.exceptions[tag] ?? []),
        ];
        if (implicitRoles.includes(role) && !allowedHere.includes(role)) {
          context.report({ node: roleAttr, message: buildMessage(tag, role) });
        }
      },
    };
  },
});
