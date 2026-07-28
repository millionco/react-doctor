import ts from "typescript";

export const containsJsx = (node: ts.Node): boolean => {
  let didFindJsx = false;
  const visit = (currentNode: ts.Node): void => {
    if (
      ts.isJsxElement(currentNode) ||
      ts.isJsxFragment(currentNode) ||
      ts.isJsxSelfClosingElement(currentNode)
    ) {
      didFindJsx = true;
      return;
    }
    currentNode.forEachChild(visit);
  };
  node.forEachChild(visit);
  return didFindJsx;
};
