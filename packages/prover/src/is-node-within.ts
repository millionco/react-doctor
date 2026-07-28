import type ts from "typescript";

export const isNodeWithin = (node: ts.Node, owner: ts.Node): boolean =>
  node.getSourceFile() === owner.getSourceFile() &&
  node.getStart() >= owner.getStart() &&
  node.getEnd() <= owner.getEnd();
