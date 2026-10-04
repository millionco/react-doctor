import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import {
  MINIMUM_PERSPECTIVE_CAMERA_ASPECT,
  MINIMUM_PERSPECTIVE_CAMERA_NEAR,
} from "../constants.js";

interface StaticCameraParameter {
  node: EsTreeNode;
  value: number;
}

interface PerspectiveCameraParameters {
  aspect: StaticCameraParameter | null;
  far: StaticCameraParameter | null;
  near: StaticCameraParameter | null;
}

interface InvalidPerspectiveCameraParameter {
  message: string;
  node: EsTreeNode;
}

export const getInvalidPerspectiveCameraParameter = (
  parameters: PerspectiveCameraParameters,
): InvalidPerspectiveCameraParameter | null => {
  if (parameters.aspect && parameters.aspect.value <= MINIMUM_PERSPECTIVE_CAMERA_ASPECT) {
    return {
      node: parameters.aspect.node,
      message:
        "This perspective camera has a non-positive aspect ratio, so its projection is invalid",
    };
  }
  if (parameters.near && parameters.near.value <= MINIMUM_PERSPECTIVE_CAMERA_NEAR) {
    return {
      node: parameters.near.node,
      message:
        "This perspective camera has a non-positive near plane, but Three.js requires near to be greater than zero",
    };
  }
  if (parameters.far && parameters.far.value <= MINIMUM_PERSPECTIVE_CAMERA_NEAR) {
    return {
      node: parameters.far.node,
      message:
        "This perspective camera has a non-positive far plane, but Three.js requires far to be greater than its positive near plane",
    };
  }
  if (parameters.far && parameters.near && parameters.far.value <= parameters.near.value) {
    return {
      node: parameters.far.node,
      message:
        "This perspective camera's far plane is not greater than its near plane, so its projection is invalid",
    };
  }
  return null;
};
