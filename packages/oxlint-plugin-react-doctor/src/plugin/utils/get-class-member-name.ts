import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";

export const getClassMemberName = (member: EsTreeNode): string | null => {
  if (isNodeOfType(member, "MethodDefinition") && member.kind === "constructor") {
    return "constructor";
  }
  return getStaticPropertyKeyName(member, { allowComputedString: true });
};
