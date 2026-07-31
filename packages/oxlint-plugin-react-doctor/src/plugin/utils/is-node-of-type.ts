import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { EsTreeNodeType } from "./es-tree-node-type.js";
import type { NodeWithOptionalType } from "./node-with-optional-type.js";

export const isNodeOfType = <NodeType extends EsTreeNodeType>(
  node: unknown,
  type: NodeType,
): node is EsTreeNodeOfType<NodeType> =>
  node !== null && typeof node === "object" && (node as NodeWithOptionalType).type === type;
