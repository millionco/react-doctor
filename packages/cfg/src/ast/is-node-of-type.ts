import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { EsTreeNodeType } from "./es-tree-node-type.js";
import { hasTypeProperty } from "./has-type-property.js";

export const isNodeOfType = <NodeType extends EsTreeNodeType>(
  node: unknown,
  type: NodeType,
): node is EsTreeNodeOfType<NodeType> => Boolean(hasTypeProperty(node) && node.type === type);
