import { isAstNode } from "./is-ast-node.js";
import type { EsTreeNode } from "oxlint-plugin-react-doctor";

interface SourcePosition {
  line: number;
  column: number;
}

interface NodeWithOffsets {
  start?: number;
  end?: number;
  loc?: { start: SourcePosition; end: SourcePosition };
}

const buildLineStartOffsets = (sourceText: string): number[] => {
  const lineStartOffsets = [0];
  for (let index = 0; index < sourceText.length; index++) {
    if (sourceText[index] === "\n") lineStartOffsets.push(index + 1);
  }
  return lineStartOffsets;
};

const offsetToPosition = (
  offset: number,
  lineStartOffsets: ReadonlyArray<number>,
): SourcePosition => {
  let low = 0;
  let high = lineStartOffsets.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStartOffsets[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  const lineIndex = Math.max(0, high);
  return { line: lineIndex + 1, column: offset - lineStartOffsets[lineIndex] };
};

// oxc-parser (with `astType: "ts"`) emits byte offsets but no `loc`. Rules and
// diagnostics want 1-based line / column, so we compute `loc` from the offsets
// up front — the same thing the oxlint host does at runtime.
export const attachSourceLocations = (root: EsTreeNode, sourceText: string): void => {
  const lineStartOffsets = buildLineStartOffsets(sourceText);
  const visit = (node: EsTreeNode): void => {
    const withOffsets = node as NodeWithOffsets;
    if (typeof withOffsets.start === "number" && typeof withOffsets.end === "number") {
      withOffsets.loc = {
        start: offsetToPosition(withOffsets.start, lineStartOffsets),
        end: offsetToPosition(withOffsets.end, lineStartOffsets),
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
