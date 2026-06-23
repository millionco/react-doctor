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

export const getNodeChild = (node: OxcAstNode, key: string): OxcAstNode | undefined => {
  const value = node[key];
  return isOxcAstNode(value) ? value : undefined;
};

export const getNodeChildArray = (node: OxcAstNode, key: string): OxcAstNode[] => {
  const value = node[key];
  if (!Array.isArray(value)) return [];
  const children: OxcAstNode[] = [];
  for (const candidate of value) {
    if (isOxcAstNode(candidate)) children.push(candidate);
  }
  return children;
};

export const getIdentifierName = (node: unknown): string | undefined => {
  if (!isOxcAstNode(node)) return undefined;
  if (node.type !== "Identifier") return undefined;
  return getNodeStringField(node, "name");
};
