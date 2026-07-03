import { ALL_EVENT_HANDLERS_LOWER } from "../../constants/event-handlers.js";
import { HTML_TAGS } from "../../constants/html-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isDisabledElement } from "../../utils/is-disabled-element.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { isNonInteractiveElement } from "../../utils/is-non-interactive-element.js";
import { isNonInteractiveRole } from "../../utils/is-non-interactive-role.js";
import { isPresentationRole } from "../../utils/is-presentation-role.js";

const buildTabbableMessage = (role: string): string =>
  `Keyboard users can't tab to this '${role}' because it isn't focusable, so add \`tabIndex={0}\`.`;
const buildFocusableMessage = (role: string): string =>
  `Keyboard users can't focus this '${role}' because it can't receive focus, so add \`tabIndex={0}\` or \`tabIndex={-1}\`.`;

const DEFAULT_TABBABLE_ROLES: ReadonlyArray<string> = [
  "button",
  "checkbox",
  "link",
  "searchbox",
  "spinbutton",
  "switch",
  "textbox",
];

interface InteractiveSupportsFocusSettings {
  tabbable?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): { tabbable: ReadonlyArray<string> } => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { interactiveSupportsFocus?: InteractiveSupportsFocusSettings })
          .interactiveSupportsFocus ?? {})
      : {};
  return { tabbable: ruleSettings.tabbable ?? DEFAULT_TABBABLE_ROLES };
};

// Port of `oxc_linter::rules::jsx_a11y::interactive_supports_focus`.
export const interactiveSupportsFocus = defineRule({
  id: "interactive-supports-focus",
  title: "Interactive element not focusable",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Add keyboard focus support so users can reach interactive elements without a pointer.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const tabbableSet = new Set(settings.tabbable);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (node.attributes.length === 0) return;
        // A spread (`{...props}`) can carry `tabIndex`, so focus support is indeterminate.
        if (hasJsxSpreadAttribute(node.attributes)) return;
        const roleAttribute = hasJsxPropIgnoreCase(node.attributes, "role");
        const role = roleAttribute ? getJsxPropStringValue(roleAttribute) : null;
        if (!role) return;
        let hasInteractiveHandler = false;
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          const attributeName = getJsxAttributeName(attribute.name);
          if (attributeName && ALL_EVENT_HANDLERS_LOWER.has(attributeName.toLowerCase())) {
            hasInteractiveHandler = true;
            break;
          }
        }
        if (!hasInteractiveHandler) return;
        const elementType = getElementType(node, context.settings);
        // Custom components (PascalCase, not in HTML_TAGS) encapsulate
        // their own focus behaviour — `<SegmentButton role="option" />`
        // and `<LemonButton>` typically manage tabIndex internally via
        // the underlying intrinsic element. Flagging them is
        // unactionable: the user can't add tabIndex to a wrapper that
        // already handles focus correctly.
        if (!HTML_TAGS.has(elementType)) return;
        if (
          isDisabledElement(node) ||
          isHiddenFromScreenReader(node, context.settings) ||
          isPresentationRole(node)
        ) {
          return;
        }
        const hasTabIndex = Boolean(hasJsxPropIgnoreCase(node.attributes, "tabIndex"));
        if (
          !isInteractiveRole(role) ||
          isInteractiveElement(elementType, node) ||
          isNonInteractiveRole(role) ||
          isNonInteractiveElement(elementType, node) ||
          hasTabIndex
        ) {
          return;
        }
        const message = tabbableSet.has(role)
          ? buildTabbableMessage(role)
          : buildFocusableMessage(role);
        context.report({ node, message });
      },
    };
  },
});
