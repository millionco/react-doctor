import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";

const buildMessage = (role: string, missingProps: ReadonlyArray<string>): string =>
  `Screen reader users can't tell the state of this \`${role}\` without its required ARIA props, so add \`${missingProps.join("`, `")}\`.`;

// Mirrors OXC's `ROLE_TO_REQUIRED_ARIA_PROPS`.
const ROLE_REQUIRED_PROPS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ["checkbox", ["aria-checked"]],
  ["combobox", ["aria-controls", "aria-expanded"]],
  ["heading", ["aria-level"]],
  ["menuitemcheckbox", ["aria-checked"]],
  ["menuitemradio", ["aria-checked"]],
  ["meter", ["aria-valuenow"]],
  ["option", ["aria-selected"]],
  ["radio", ["aria-checked"]],
  ["scrollbar", ["aria-controls", "aria-valuenow"]],
  ["slider", ["aria-valuenow"]],
  ["switch", ["aria-checked"]],
]);

const NATIVE_CHECKED_STATE_PROP = "aria-checked";

// A native `<input type="checkbox|radio">` with a `checked`/`defaultChecked`
// binding maps its DOM checked state into the accessibility tree intrinsically,
// so an overriding role (e.g. `switch`) doesn't also need an explicit
// `aria-checked`. A custom `<div role="switch">` has no such intrinsic state.
const suppliesNativeCheckedState = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  if (getElementType(node, settings) !== "input") return false;
  const typeAttribute = hasJsxPropIgnoreCase(node.attributes, "type");
  const inputType = typeAttribute ? getJsxPropStringValue(typeAttribute) : null;
  if (inputType !== "checkbox" && inputType !== "radio") return false;
  return (
    Boolean(hasJsxPropIgnoreCase(node.attributes, "checked")) ||
    Boolean(hasJsxPropIgnoreCase(node.attributes, "defaultChecked"))
  );
};

// Port of `oxc_linter::rules::jsx_a11y::role_has_required_aria_props`.
export const roleHasRequiredAriaProps = defineRule({
  id: "role-has-required-aria-props",
  title: "Role missing required ARIA props",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Add every required `aria-*` attribute so assistive tech can expose the role's state correctly.",
  category: "Accessibility",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
      if (!roleAttribute) return;
      const roleValue = getJsxPropStringValue(roleAttribute);
      if (roleValue === null) return;
      const roles = roleValue.split(/\s+/).filter((token) => token.length > 0);
      const nativeCheckedState = suppliesNativeCheckedState(node, context.settings);
      for (const role of roles) {
        const required = ROLE_REQUIRED_PROPS.get(role);
        if (!required) continue;
        const missing = required.filter((property) => {
          if (property === NATIVE_CHECKED_STATE_PROP && nativeCheckedState) return false;
          return !hasJsxPropIgnoreCase(node.attributes, property);
        });
        if (missing.length > 0) {
          context.report({ node: roleAttribute, message: buildMessage(role, missing) });
        }
      }
    },
  }),
});
