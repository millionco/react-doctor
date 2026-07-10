import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { EsTreeNodeType } from "./es-tree-node-type.js";

export const isNodeOfType = <NodeType extends EsTreeNodeType>(
  node: unknown,
  type: NodeType,
): node is EsTreeNodeOfType<NodeType> =>
  node !== null && typeof node === "object" && "type" in node && node.type === type;
