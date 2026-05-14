// Loose base shape used everywhere a rule body walks an arbitrary AST. The
// `type` field stays a plain `string` so existing rule code that checks
// `node.type === "Literal"` keeps working without exhaustively narrowing first.
// Real per-node-type shapes live in `EsTreeNodeOfType<T>` (which derives from
// TSESTree) and are reached via `isNodeOfType(node, "...")`.
export interface EsTreeNode {
  type: string;
  parent?: EsTreeNode | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
