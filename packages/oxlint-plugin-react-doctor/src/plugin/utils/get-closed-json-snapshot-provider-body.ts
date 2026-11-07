import type { EsTreeNode } from "./es-tree-node.js";

export interface ClosedJsonSnapshotProviderBody {
  readonly declarations: ReadonlyArray<EsTreeNode>;
  readonly terminal: EsTreeNode;
}

export const getClosedJsonSnapshotProviderBody = (
  body: EsTreeNode,
  terminalType: "ReturnStatement" | "ExpressionStatement",
): ClosedJsonSnapshotProviderBody | null => {
  if (body.type !== "BlockStatement") return null;
  const terminal = body.body.at(-1);
  if (!terminal || terminal.type !== terminalType) return null;
  const expression = terminal.type === "ReturnStatement" ? terminal.argument : terminal.expression;
  if (!expression) return null;
  const declarations: EsTreeNode[] = [];
  for (const statement of body.body.slice(0, -1)) {
    if (statement.type !== "VariableDeclaration" || !["const", "let"].includes(statement.kind))
      return null;
    const declaration = statement.declarations[0];
    if (
      statement.declarations.length !== 1 ||
      declaration?.id.type !== "Identifier" ||
      !declaration.init
    )
      return null;
    declarations.push(declaration);
  }
  return { declarations, terminal: expression };
};
