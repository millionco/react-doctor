import type { EsTreeNode } from "../../../utils/es-tree-node.js";

interface ComparableCallbackIdentity {
  readonly node: EsTreeNode;
  readonly isConcreteFunction: boolean;
}

export const compareListenerCallbackIdentities = (
  registrationIdentity: ComparableCallbackIdentity,
  removalIdentity: ComparableCallbackIdentity,
): "same" | "different" | "unknown" => {
  if (registrationIdentity.node === removalIdentity.node) return "same";
  if (registrationIdentity.isConcreteFunction && removalIdentity.isConcreteFunction) {
    return "different";
  }
  return "unknown";
};
