import ts from "typescript";
import { getNodeLocation } from "./get-node-location.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import type { ReactProofLocation } from "./types.js";

export const findFunctionByLocation = (
  program: ts.Program,
  rootDirectory: string,
  location: ReactProofLocation,
): ts.FunctionLikeDeclaration | null => {
  let matchingFunction: ts.FunctionLikeDeclaration | null = null;
  const visit = (node: ts.Node): void => {
    if (matchingFunction) return;
    if (isFunctionBoundary(node)) {
      const nodeLocation = getNodeLocation(node, rootDirectory);
      if (
        nodeLocation.filePath === location.filePath &&
        nodeLocation.line === location.line &&
        nodeLocation.column === location.column
      ) {
        matchingFunction = node;
        return;
      }
    }
    node.forEachChild(visit);
  };
  for (const sourceFile of program.getSourceFiles()) {
    sourceFile.forEachChild(visit);
    if (matchingFunction) return matchingFunction;
  }
  return null;
};
