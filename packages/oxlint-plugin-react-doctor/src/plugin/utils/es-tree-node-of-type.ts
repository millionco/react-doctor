import type { TSESTree } from "@typescript-eslint/types";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeType } from "./es-tree-node-type.js";

// Distributes over the union so we can override `parent` without collapsing
// discriminants. TSESTree pins each node's parent to a specific node kind
// (e.g. JSXAttribute.parent: JSXOpeningElement), but our walker assigns
// parent freely as it descends, so we relax it to `EsTreeNode | null` here.
type WithLooseParent<NodeType> = NodeType extends NodeType
  ? Omit<NodeType, "parent"> & { parent?: EsTreeNode | null }
  : never;

// Resolves a string `type` discriminant to the real TSESTree shape when known,
// falling back to a loose `EsTreeNode & { type }` for nodes that TSESTree
// doesn't model (none today, but keeps the helper safe under future TS evolution).
export type EsTreeNodeOfType<NodeType extends EsTreeNodeType> =
  Extract<TSESTree.Node, { type: NodeType }> extends never
    ? EsTreeNode & { type: NodeType }
    : WithLooseParent<Extract<TSESTree.Node, { type: NodeType }>>;
