import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import {
  MAXIMUM_NORMALIZED_MATERIAL_FACTOR,
  MAXIMUM_PHYSICAL_MATERIAL_IOR,
  MINIMUM_NORMALIZED_MATERIAL_FACTOR,
  MINIMUM_PHYSICAL_MATERIAL_IOR,
  PHYSICAL_MATERIAL_IOR_PROPERTY_NAMES,
  PHYSICAL_MATERIAL_NORMALIZED_PROPERTY_NAMES,
} from "../constants.js";

interface InvalidPhysicalMaterialProperty {
  readonly maximum: number;
  readonly minimum: number;
  readonly node: EsTreeNode;
  readonly propertyName: string;
  readonly value: number;
}

export const getInvalidPhysicalMaterialProperty = (
  propertyName: string,
  value: number,
  node: EsTreeNode,
): InvalidPhysicalMaterialProperty | null => {
  const range = PHYSICAL_MATERIAL_NORMALIZED_PROPERTY_NAMES.has(propertyName)
    ? {
        minimum: MINIMUM_NORMALIZED_MATERIAL_FACTOR,
        maximum: MAXIMUM_NORMALIZED_MATERIAL_FACTOR,
      }
    : PHYSICAL_MATERIAL_IOR_PROPERTY_NAMES.has(propertyName)
      ? { minimum: MINIMUM_PHYSICAL_MATERIAL_IOR, maximum: MAXIMUM_PHYSICAL_MATERIAL_IOR }
      : null;
  return range && (value < range.minimum || value > range.maximum)
    ? { ...range, node, propertyName, value }
    : null;
};
