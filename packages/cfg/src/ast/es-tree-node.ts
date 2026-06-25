import type { TSESTree } from "@typescript-eslint/types";

// Distributes over the TSESTree.Node union so each member gets its `parent`
// relaxed independently — TSESTree pins each node's parent to a specific
// kind (e.g. JSXAttribute.parent: JSXOpeningElement) but a walker assigns
// parent freely as it descends, so we re-broaden to `EsTreeNode | null` here.
type WithLooseParent<NodeType> = NodeType extends NodeType
  ? Omit<NodeType, "parent"> & { parent?: EsTreeNode | null }
  : never;

// THE AST node type the CFG builder walks. It's the full TSESTree
// discriminated union (every concrete node kind) with the `parent` field
// relaxed. Structurally identical to the consuming plugin's own
// `EsTreeNode`, so nodes cross the package boundary without a cast.
export type EsTreeNode = WithLooseParent<TSESTree.Node>;
