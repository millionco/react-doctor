import type { EsTreeNode } from "../plugin/utils/es-tree-node.js";
import { isAstNode } from "../plugin/utils/is-ast-node.js";

interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

interface NodeWithOffsets {
  readonly start?: number;
  readonly end?: number;
  range?: [number, number];
  loc?: {
    readonly start: SourcePosition;
    readonly end: SourcePosition;
  };
}

const buildLineStartOffsets = (sourceText: string): ReadonlyArray<number> => {
  const lineStartOffsets = [0];
  for (let sourceIndex = 0; sourceIndex < sourceText.length; sourceIndex++) {
    if (sourceText[sourceIndex] === "\n") lineStartOffsets.push(sourceIndex + 1);
  }
  return lineStartOffsets;
};

const getSourcePosition = (
  offset: number,
  lineStartOffsets: ReadonlyArray<number>,
): SourcePosition => {
  let lowerIndex = 0;
  let upperIndex = lineStartOffsets.length - 1;
  while (lowerIndex <= upperIndex) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (lineStartOffsets[middleIndex] <= offset) {
      lowerIndex = middleIndex + 1;
    } else {
      upperIndex = middleIndex - 1;
    }
  }
  const lineIndex = Math.max(0, upperIndex);
  return {
    line: lineIndex + 1,
    column: offset - lineStartOffsets[lineIndex],
  };
};

export const attachSourceLocations = (root: EsTreeNode, sourceText: string): void => {
  const lineStartOffsets = buildLineStartOffsets(sourceText);
  const visitNode = (node: EsTreeNode): void => {
    const nodeWithOffsets = node as NodeWithOffsets;
    if (typeof nodeWithOffsets.start === "number" && typeof nodeWithOffsets.end === "number") {
      nodeWithOffsets.loc = {
        start: getSourcePosition(nodeWithOffsets.start, lineStartOffsets),
        end: getSourcePosition(nodeWithOffsets.end, lineStartOffsets),
      };
      nodeWithOffsets.range ??= [nodeWithOffsets.start, nodeWithOffsets.end];
    }

    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const childNode of child) {
          if (isAstNode(childNode)) visitNode(childNode);
        }
      } else if (isAstNode(child)) {
        visitNode(child);
      }
    }
  };
  visitNode(root);
};
