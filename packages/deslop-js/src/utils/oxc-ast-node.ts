export interface OxcAstNode {
  type: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

export const isOxcAstNode = (value: unknown): value is OxcAstNode =>
  Boolean(value) && typeof value === "object" && typeof (value as OxcAstNode).type === "string";

export const getNodeStringField = (node: OxcAstNode, key: string): string | undefined => {
  const value = node[key];
  return typeof value === "string" ? value : undefined;
};

export const getIdentifierName = (node: unknown): string | undefined => {
  if (!isOxcAstNode(node)) return undefined;
  if (node.type !== "Identifier") return undefined;
  return getNodeStringField(node, "name");
};
