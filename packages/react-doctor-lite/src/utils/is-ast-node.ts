import type { EsTreeNode } from "oxlint-plugin-react-doctor";

export const isAstNode = (value: unknown): value is EsTreeNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";
