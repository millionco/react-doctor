import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import {
  MAXIMUM_SPOT_LIGHT_ANGLE_RADIANS,
  MAXIMUM_SPOT_LIGHT_PENUMBRA,
  MINIMUM_SPOT_LIGHT_ANGLE_RADIANS,
  MINIMUM_SPOT_LIGHT_PENUMBRA,
} from "../constants.js";

interface InvalidSpotLightProperty {
  readonly message: string;
  readonly node: EsTreeNode;
}

export const getInvalidSpotLightProperty = (
  propertyName: string,
  value: number,
  node: EsTreeNode,
): InvalidSpotLightProperty | null => {
  if (
    propertyName === "angle" &&
    (value <= MINIMUM_SPOT_LIGHT_ANGLE_RADIANS || value > MAXIMUM_SPOT_LIGHT_ANGLE_RADIANS)
  ) {
    return {
      node,
      message: "SpotLight angle must be greater than zero and no greater than Math.PI / 2",
    };
  }
  if (
    propertyName === "penumbra" &&
    (value < MINIMUM_SPOT_LIGHT_PENUMBRA || value > MAXIMUM_SPOT_LIGHT_PENUMBRA)
  ) {
    return { node, message: "SpotLight penumbra must be in the normalized [0, 1] range" };
  }
  return null;
};
