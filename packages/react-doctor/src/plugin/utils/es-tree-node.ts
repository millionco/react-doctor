import type { TSESTree } from "@typescript-eslint/types";

// Distributes over the TSESTree.Node union so each member gets its `parent`
// relaxed independently — TSESTree pins each node's parent to a specific
// kind (e.g. JSXAttribute.parent: JSXOpeningElement) but our walker assigns
// parent freely as it descends, so we re-broaden to `EsTreeNode | null` here.
type WithLooseParent<NodeType> = NodeType extends NodeType
  ? Omit<NodeType, "parent"> & { parent?: EsTreeNode | null }
  : never;

// THE AST node type used everywhere a rule body walks an arbitrary AST.
// It's the full TSESTree discriminated union (every concrete node kind),
// with the `parent` field relaxed. Discriminated-union narrowing on
// `.type` works natively — `node.type === "CallExpression"` narrows
// `node.callee` to `Expression` etc. — and there's no `[key: string]: any`
// escape hatch, so every property access requires the narrowing to have
// happened first. `isNodeOfType(node, "X")` is the runtime-safe entry
// point for narrowing through opaque helpers; native `===` works inline.
export type EsTreeNode = WithLooseParent<TSESTree.Node>;
