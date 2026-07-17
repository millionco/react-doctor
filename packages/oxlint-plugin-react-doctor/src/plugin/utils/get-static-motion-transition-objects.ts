import { MOTION_ANIMATE_PROPS } from "../constants/style.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { getEffectiveStyleProperty } from "../rules/design/utils/get-effective-style-property.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticMotionPropObject } from "./get-static-motion-prop-object.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticMotionTransitionObjects = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): ReadonlyArray<EsTreeNodeOfType<"ObjectExpression">> => {
  const transitionObjects: EsTreeNodeOfType<"ObjectExpression">[] = [];
  const transitionPropertyObject = getStaticMotionPropObject(openingElement, "transition", scopes);
  if (transitionPropertyObject) transitionObjects.push(transitionPropertyObject);

  for (const animationPropertyName of MOTION_ANIMATE_PROPS) {
    const animationObject = getStaticMotionPropObject(
      openingElement,
      animationPropertyName,
      scopes,
    );
    if (!animationObject) continue;
    const transitionProperty = getEffectiveStyleProperty(animationObject.properties, "transition");
    if (transitionProperty && isNodeOfType(transitionProperty.value, "ObjectExpression")) {
      transitionObjects.push(transitionProperty.value);
    }
  }

  return transitionObjects;
};
