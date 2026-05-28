import { isAstNode } from "../plugin/utils/is-ast-node.js";
import type { EsTreeNode } from "../plugin/utils/es-tree-node.js";

interface SourcePosition {
  line: number;
  column: number;
}

interface NodeWithOffsets {
  start?: number;
  end?: number;
  loc?: {
    start: SourcePosition;
    end: SourcePosition;
  };
}

const buildLineStartOffsets = (sourceText: string): number[] => {
  const lineStartOffsets = [0];
  for (let sourceIndex = 0; sourceIndex < sourceText.length; sourceIndex++) {
    if (sourceText[sourceIndex] === "\n") lineStartOffsets.push(sourceIndex + 1);
  }
  return lineStartOffsets;
};

const offsetToSourcePosition = (
  offset: number,
  lineStartOffsets: ReadonlyArray<number>,
): SourcePosition => {
  let lowIndex = 0;
  let highIndex = lineStartOffsets.length - 1;
  while (lowIndex <= highIndex) {
    const middleIndex = Math.floor((lowIndex + highIndex) / 2);
    if (lineStartOffsets[middleIndex] <= offset) {
      lowIndex = middleIndex + 1;
    } else {
      highIndex = middleIndex - 1;
    }
  }
  const lineIndex = Math.max(0, highIndex);
  return {
    line: lineIndex + 1,
    column: offset - lineStartOffsets[lineIndex],
  };
};

export const attachSourceLocations = (root: EsTreeNode, sourceText: string): void => {
  const lineStartOffsets = buildLineStartOffsets(sourceText);
  const visit = (node: EsTreeNode): void => {
    const nodeWithOffsets = node as NodeWithOffsets;
    if (typeof nodeWithOffsets.start === "number" && typeof nodeWithOffsets.end === "number") {
      nodeWithOffsets.loc = {
        start: offsetToSourcePosition(nodeWithOffsets.start, lineStartOffsets),
        end: offsetToSourcePosition(nodeWithOffsets.end, lineStartOffsets),
      };
    }

    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (isAstNode(item)) visit(item);
        }
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(root);
};
