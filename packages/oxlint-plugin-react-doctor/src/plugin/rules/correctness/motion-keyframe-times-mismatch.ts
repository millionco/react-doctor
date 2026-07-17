import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticArrayExpressionLength } from "../../utils/get-static-array-expression-length.js";
import { getStaticMotionPropObject } from "../../utils/get-static-motion-prop-object.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "../design/utils/get-effective-style-property.js";

const getKeyframeLengths = (
  animationObject: EsTreeNodeOfType<"ObjectExpression">,
): ReadonlyArray<number> | null => {
  const keyframeLengths: number[] = [];
  for (const property of animationObject.properties) {
    if (!isNodeOfType(property, "Property")) return null;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName) return null;
    if (propertyName === "transition") continue;
    const length = getStaticArrayExpressionLength(property.value);
    if (length !== null) keyframeLengths.push(length);
  }
  return keyframeLengths;
};

const getNestedTransition = (
  animationObject: EsTreeNodeOfType<"ObjectExpression">,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const transitionProperty = getEffectiveStyleProperty(animationObject.properties, "transition");
  return transitionProperty && isNodeOfType(transitionProperty.value, "ObjectExpression")
    ? transitionProperty.value
    : null;
};

export const motionKeyframeTimesMismatch = defineRule({
  id: "motion-keyframe-times-mismatch",
  title: "Motion keyframes and times have different lengths",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Provide one transition time for each keyframe so Motion can place every value on the animation timeline.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const animationObject = getStaticMotionPropObject(node, "animate", context.scopes);
      if (!animationObject) return;
      const keyframeLengths = getKeyframeLengths(animationObject);
      if (!keyframeLengths?.length) return;
      const directTransition = getStaticMotionPropObject(node, "transition", context.scopes);
      const transitionObject = getNestedTransition(animationObject) ?? directTransition;
      if (!transitionObject) return;
      const timesProperty = getEffectiveStyleProperty(transitionObject.properties, "times");
      if (!timesProperty) return;
      const timesLength = getStaticArrayExpressionLength(timesProperty.value);
      if (timesLength === null || keyframeLengths.every((length) => length === timesLength)) return;
      const keyframeLength = keyframeLengths.find((length) => length !== timesLength);
      context.report({
        node: timesProperty,
        message: `This transition has ${timesLength} time stops for ${keyframeLength} keyframes. The times array must match the keyframe count.`,
      });
    },
  }),
});
