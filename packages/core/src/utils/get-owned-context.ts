import ts from "typescript";
import type { ChangedContext } from "./does-context-intersect-changes.js";

interface OwnedContextInput {
  readonly sourceFile: ts.SourceFile;
  readonly owner: ts.Node;
  readonly isBoundary: (node: ts.Node) => boolean;
}

export const getOwnedContext = ({
  sourceFile,
  owner,
  isBoundary,
}: OwnedContextInput): ChangedContext => {
  const excludedRanges: Array<readonly [number, number]> = [];
  const collectChildren = (node: ts.Node): void => {
    if (isBoundary(node)) {
      excludedRanges.push([
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        sourceFile.getLineAndCharacterOfPosition(node.getEnd() - 1).line + 1,
      ]);
      return;
    }
    ts.forEachChild(node, collectChildren);
  };
  ts.forEachChild(owner, collectChildren);
  return {
    range: [
      sourceFile.getLineAndCharacterOfPosition(owner.getStart(sourceFile)).line + 1,
      sourceFile.getLineAndCharacterOfPosition(owner.getEnd() - 1).line + 1,
    ],
    excludedRanges,
  };
};
