import type { EsTreeNode } from "./es-tree-node.js";
import { getEffectiveStyleProperty } from "../rules/design/utils/get-effective-style-property.js";
import { getStylePropertyStringValue } from "../rules/design/utils/get-style-property-string-value.js";

const PHYSICS_SPRING_PROPERTY_NAMES = ["stiffness", "damping", "mass"];
const DURATION_SPRING_PROPERTY_NAMES = ["duration", "bounce"];

export const getConflictingMotionSpringDurationProperty = (
  properties: ReadonlyArray<EsTreeNode>,
): EsTreeNode | null => {
  const typeProperty = getEffectiveStyleProperty(properties, "type");
  if (!typeProperty || getStylePropertyStringValue(typeProperty) !== "spring") return null;

  const hasPhysicsProperty = PHYSICS_SPRING_PROPERTY_NAMES.some((propertyName) =>
    Boolean(getEffectiveStyleProperty(properties, propertyName)),
  );
  if (!hasPhysicsProperty) return null;

  return (
    DURATION_SPRING_PROPERTY_NAMES.map((propertyName) =>
      getEffectiveStyleProperty(properties, propertyName),
    ).find(Boolean) ?? null
  );
};
