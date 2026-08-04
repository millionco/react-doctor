import * as path from "node:path";
import type ts from "typescript";
import type { ReactProofLocation } from "./types.js";

export const getNodeLocation = (node: ts.Node, rootDirectory: string): ReactProofLocation => {
  const sourceFile = node.getSourceFile();
  const sourcePosition = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    filePath: path.relative(rootDirectory, sourceFile.fileName),
    line: sourcePosition.line + 1,
    column: sourcePosition.character + 1,
  };
};
