import { defineRule } from "../../utils/define-rule.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticMotionPropObject } from "../../utils/get-static-motion-prop-object.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";

const ORIGIN_PROPERTY_NAMES = ["transformOrigin", "originX", "originY"];
const REVEAL_ROLES = new Set(["listbox", "menu"]);

const hasScaleReveal = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean =>
  ["initial", "exit"].some((propertyName) => {
    const motionObject = getStaticMotionPropObject(openingElement, propertyName, context.scopes);
    const scaleProperty = motionObject
      ? getEffectiveStyleProperty(motionObject.properties, "scale")
      : null;
    const scale = scaleProperty ? getStylePropertyNumberValue(scaleProperty) : null;
    return scale !== null && scale >= 0 && scale < 1;
  });

const hasExplicitOrigin = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const tokens = getUnvariantClassNameTokens(getStringFromClassNameAttr(openingElement) ?? "");
  if (tokens.some((token) => token.startsWith("origin-"))) return true;
  return openingElement.attributes.some((attribute) => {
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const styleExpression = getInlineStyleExpression(attribute);
    return Boolean(
      styleExpression &&
      ORIGIN_PROPERTY_NAMES.some((propertyName) =>
        getEffectiveStyleProperty(styleExpression.properties, propertyName),
      ),
    );
  });
};

export const requireScaleRevealTransformOrigin = defineRule({
  id: "require-scale-reveal-transform-origin",
  title: "Scaled menu omits its transform origin",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation: "Anchor scaled menus and listboxes to the edge nearest their trigger.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const roleAttribute = getAuthoritativeJsxAttribute(node.attributes, "role", false);
      const role = roleAttribute ? getStringLiteralAttributeValue(roleAttribute) : null;
      if (
        !role ||
        !REVEAL_ROLES.has(role.toLowerCase()) ||
        !hasScaleReveal(node, context) ||
        hasExplicitOrigin(node)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This menu scales into view without an explicit transform origin, so it expands from its center instead of its trigger. Set a static origin that matches the attachment edge.",
      });
    },
  }),
});
