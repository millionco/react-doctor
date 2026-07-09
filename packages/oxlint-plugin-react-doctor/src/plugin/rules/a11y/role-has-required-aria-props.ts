import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";

const buildMessage = (role: string, missingProps: ReadonlyArray<string>): string =>
  `Screen reader users can't tell the state of this \`${role}\` without its required ARIA props, so add \`${missingProps.join(
    "`, `",
  )}\`.`;

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

// Value props a native `<input type="range">` (→ slider) maps into the
// accessibility tree from its DOM value, min, and max intrinsically.
const NATIVE_VALUE_PROPS: ReadonlySet<string> = new Set([
  "aria-valuenow",
  "aria-valuemin",
  "aria-valuemax",
]);

// A native input maps certain DOM state into the accessibility tree
// intrinsically, so an overriding role doesn't also need the explicit
// `aria-*` mirror: `<input type="checkbox|radio">` supplies `aria-checked`
// from its native checkedness (even uncontrolled — ARIA in HTML forbids
// setting `aria-checked` on it); `<input type="range">` supplies the
// slider value props. A custom `<div role="...">` has no such intrinsic
// state, so it still must declare the prop.
const NATIVE_HEADING_TAGS: ReadonlySet<string> = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

// A native `<select>`'s implicit role is combobox: the browser exposes its
// expansion state and owns its option popup, so an explicit redundant
// `role="combobox"` doesn't also need `aria-controls`/`aria-expanded`.
const NATIVE_COMBOBOX_PROPS: ReadonlySet<string> = new Set(["aria-controls", "aria-expanded"]);

const suppliesNativeAriaProp = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  elementType: string,
  property: string,
): boolean => {
  // A native `<h1>`–`<h6>` carries an intrinsic heading level, so an
  // explicit `role="heading"` doesn't also need `aria-level` spelled out.
  if (property === "aria-level" && NATIVE_HEADING_TAGS.has(elementType)) return true;
  if (elementType === "select") return NATIVE_COMBOBOX_PROPS.has(property);
  // A native `<option>` exposes selectedness from its DOM `selected` state.
  if (property === "aria-selected" && elementType === "option") return true;
  if (elementType !== "input") return false;
  const typeAttribute = hasJsxPropIgnoreCase(node.attributes, "type");
  const inputType = typeAttribute ? getJsxPropStringValue(typeAttribute) : null;
  if (property === "aria-checked") return inputType === "checkbox" || inputType === "radio";
  if (NATIVE_VALUE_PROPS.has(property)) return inputType === "range";
  return false;
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
      const elementType = getElementType(node, context.settings);
      if (!HTML_TAGS.has(elementType)) return;
      const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
      if (!roleAttribute) return;
      // Static resolution covers `role={cond ? "checkbox" : "radio"}` and
      // const-bound roles, not just the literal. Every resolved candidate
      // is validated — a branch missing its required props is a bug
      // whenever that branch is taken.
      const roleCandidates = getJsxPropStaticStringValues(roleAttribute, context.scopes);
      if (roleCandidates === null) return;
      const roles = new Set(
        roleCandidates.flatMap((candidate) =>
          candidate.split(/\s+/).filter((token) => token.length > 0),
        ),
      );
      for (const role of roles) {
        const required = ROLE_REQUIRED_PROPS.get(role);
        if (!required) continue;
        const missing = required.filter((property) => {
          if (suppliesNativeAriaProp(node, elementType, property)) return false;
          return !hasJsxPropIgnoreCase(node.attributes, property);
        });
        if (missing.length > 0) {
          context.report({
            node: roleAttribute,
            message: buildMessage(role, missing),
          });
        }
      }
    },
  }),
});
