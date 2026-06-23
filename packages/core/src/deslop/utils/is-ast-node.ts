export interface AstNode {
  type: string;
  [field: string]: unknown;
}

export const isAstNode = (candidate: unknown): candidate is AstNode =>
  typeof candidate === "object" && candidate !== null && "type" in candidate;
