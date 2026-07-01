import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getReactDoctorStringArraySetting } from "../../utils/get-react-doctor-setting.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const RADIO_COMPONENTS_SETTING = "radioInputMissingName.radioComponents";

export const radioInputMissingName = defineRule({
  id: "radio-input-missing-name",
  title: "Radio input missing name",
  category: "Accessibility",
  severity: "warn",
  recommendation:
    'Give every radio in the same group the same `name` prop (e.g. `<input type="radio" name="shippingSpeed" />`). The browser groups radios and enables arrow-key navigation only when they share a `name`.',
  create: (context: RuleContext) => {
    const radioComponents = new Set(
      getReactDoctorStringArraySetting(context.settings, RADIO_COMPONENTS_SETTING),
    );

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const attributes = node.attributes ?? [];

        // A spread could supply `name` at runtime (react-hook-form's
        // `register()`, Radix, Headless UI) — proving its absence is
        // impossible, so stay quiet.
        if (hasJsxSpreadAttribute(attributes)) return;

        const elementType = getElementType(node, context.settings);
        const isAllowlistedRadioComponent = radioComponents.has(elementType);

        if (!isAllowlistedRadioComponent) {
          if (elementType !== "input") return;
          const typeAttribute = findJsxAttribute(attributes, "type");
          if (!typeAttribute || getJsxPropStringValue(typeAttribute) !== "radio") return;
        }

        if (findJsxAttribute(attributes, "name")) return;

        context.report({
          node,
          message:
            "Users can check several of these radios at once and keyboard users can't arrow between them because they share no `name`. Give every radio in this group the same `name` prop.",
        });
      },
    };
  },
});
