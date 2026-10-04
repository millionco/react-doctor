import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { MINIMUM_RAYCASTER_NEAR } from "../constants.js";

interface StaticRaycasterParameter {
  readonly node: EsTreeNode;
  readonly value: number;
}

interface InvalidRaycasterParameter {
  readonly message: string;
  readonly node: EsTreeNode;
}

export const getInvalidRaycasterParameter = (
  near: StaticRaycasterParameter | null,
  far: StaticRaycasterParameter | null,
): InvalidRaycasterParameter | null => {
  if (near && near.value < MINIMUM_RAYCASTER_NEAR) {
    return { node: near.node, message: "Raycaster near cannot be negative" };
  }
  if (near && far && far.value < near.value) {
    return { node: far.node, message: "Raycaster far cannot be lower than near" };
  }
  return null;
};
