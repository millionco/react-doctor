import ts from "typescript";

export const findNodeAtOffset = (
  sourceFile: ts.SourceFile,
  targetOffset: number,
): ts.Node | null => {
  let matchedNode: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) > targetOffset || node.getEnd() <= targetOffset) return;
    matchedNode = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matchedNode;
};
