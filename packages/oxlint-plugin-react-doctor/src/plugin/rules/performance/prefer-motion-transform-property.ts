import { MOTION_ANIMATE_PROPS } from "../../constants/style.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticMotionPropObject } from "../../utils/get-static-motion-prop-object.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const INDIVIDUAL_MOTION_TRANSFORM_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "x",
  "y",
  "z",
  "translateX",
  "translateY",
  "translateZ",
  "scale",
  "scaleX",
  "scaleY",
  "rotate",
  "rotateX",
  "rotateY",
  "rotateZ",
  "skewX",
  "skewY",
  "transformPerspective",
]);

export const preferMotionTransformProperty = defineRule({
  id: "prefer-motion-transform-property",
  title: "Motion individual transforms miss compositor acceleration",
  severity: "warn",
  tags: ["design", "opt-in"],
  defaultEnabled: false,
  category: "Performance",
  recommendation:
    "For animation that must remain smooth while JavaScript is busy, animate one `transform` string instead of Motion's individual transform keys.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const individualTransformPropertyNames = new Set<string>();
      let firstIndividualTransformProperty: EsTreeNode | null = null;

      for (const animationPropertyName of MOTION_ANIMATE_PROPS) {
        if (animationPropertyName === "initial") continue;
        const animationObject = getStaticMotionPropObject(
          node,
          animationPropertyName,
          context.scopes,
        );
        if (!animationObject) continue;

        const animationTransformProperties: EsTreeNode[] = [];
        let hasDirectTransform = false;
        for (const property of animationObject.properties ?? []) {
          const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
          if (!propertyName) {
            animationTransformProperties.length = 0;
            break;
          }
          if (propertyName === "transform") hasDirectTransform = true;
          if (INDIVIDUAL_MOTION_TRANSFORM_PROPERTY_NAMES.has(propertyName)) {
            animationTransformProperties.push(property);
          }
        }
        if (hasDirectTransform || animationTransformProperties.length === 0) continue;

        firstIndividualTransformProperty ??= animationTransformProperties[0];
        for (const property of animationTransformProperties) {
          const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
          if (propertyName) individualTransformPropertyNames.add(propertyName);
        }
      }

      if (!firstIndividualTransformProperty) return;
      context.report({
        node: firstIndividualTransformProperty,
        message: `Motion's individual ${[...individualTransformPropertyNames].join(", ")} transform keys can keep this animation on the main thread. Use a single transform string when compositor acceleration is important.`,
      });
    },
  }),
});
