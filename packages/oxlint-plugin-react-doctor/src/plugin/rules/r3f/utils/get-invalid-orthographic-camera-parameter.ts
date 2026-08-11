import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { MINIMUM_ORTHOGRAPHIC_CAMERA_NEAR } from "../constants.js";

interface StaticOrthographicCameraParameter {
  readonly node: EsTreeNode;
  readonly value: number;
}

interface StaticOrthographicCameraParameters {
  readonly bottom: StaticOrthographicCameraParameter | null;
  readonly far: StaticOrthographicCameraParameter | null;
  readonly left: StaticOrthographicCameraParameter | null;
  readonly near: StaticOrthographicCameraParameter | null;
  readonly right: StaticOrthographicCameraParameter | null;
  readonly top: StaticOrthographicCameraParameter | null;
}

interface InvalidOrthographicCameraParameter {
  readonly message: string;
  readonly node: EsTreeNode;
}

export const getInvalidOrthographicCameraParameter = (
  parameters: StaticOrthographicCameraParameters,
): InvalidOrthographicCameraParameter | null => {
  if (parameters.left && parameters.right && parameters.left.value === parameters.right.value) {
    return {
      node: parameters.right.node,
      message: "OrthographicCamera left and right planes must differ",
    };
  }
  if (parameters.top && parameters.bottom && parameters.top.value === parameters.bottom.value) {
    return {
      node: parameters.bottom.node,
      message: "OrthographicCamera top and bottom planes must differ",
    };
  }
  if (parameters.near && parameters.near.value < MINIMUM_ORTHOGRAPHIC_CAMERA_NEAR) {
    return {
      node: parameters.near.node,
      message: "OrthographicCamera near must be zero or greater",
    };
  }
  if (parameters.near && parameters.far && parameters.far.value <= parameters.near.value) {
    return {
      node: parameters.far.node,
      message: "OrthographicCamera far must be greater than near",
    };
  }
  return null;
};
