import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getReactDoctorStringArraySetting } from "../../utils/get-react-doctor-setting.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isLiteralVoidExpression } from "../../utils/is-literal-void-expression.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const RADIO_COMPONENTS_SETTING = "radioInputMissingName.radioComponents";

const nameAttributeMayCreateGroup = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  context: RuleContext,
): boolean => {
  if (!attribute.value) return false;
  if (isNodeOfType(attribute.value, "Literal")) {
    if (attribute.value.value === null || typeof attribute.value.value === "boolean") return false;
    return typeof attribute.value.value !== "string" || attribute.value.value.trim().length > 0;
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal")) {
    if (expression.value === null || typeof expression.value === "boolean") return false;
    return typeof expression.value !== "string" || expression.value.trim().length > 0;
  }
  if (isLiteralVoidExpression(expression)) return false;
  if (
    isNodeOfType(expression, "Identifier") &&
    expression.name === "undefined" &&
    context.scopes.isGlobalReference(expression)
  ) {
    return false;
  }
  return true;
};
const isGroupProviderName = (elementName: string): boolean => {
  const nameSegments = elementName.split(".");
  const finalSegment = nameSegments.at(-1) ?? "";
  if (finalSegment === "RadioGroup") return true;
  if (finalSegment !== "Group") return false;
  return (nameSegments.at(-2) ?? "").endsWith("Radio");
};

const hasGroupProviderAncestor = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = openingElement.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const ancestorName = flattenJsxName(ancestor.openingElement.name);
      if (ancestorName && isGroupProviderName(ancestorName)) return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

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

        // Library group wrappers (Mantine/antd `Radio.Group`, Chakra
        // `RadioGroup`, …) supply `name` to their radios via context.
        if (isAllowlistedRadioComponent && hasGroupProviderAncestor(node)) return;

        const nameAttribute = findJsxAttribute(attributes, "name");
        if (nameAttribute && nameAttributeMayCreateGroup(nameAttribute, context)) return;

        context.report({
          node,
          message:
            "Users can check several of these radios at once and keyboard users can't arrow between them because they share no `name`. Give every radio in this group the same `name` prop.",
        });
      },
    };
  },
});
