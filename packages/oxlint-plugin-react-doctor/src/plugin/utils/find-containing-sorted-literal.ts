import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getNodeEndIndex } from "./get-node-end-index.js";
import { getNodeStartIndex } from "./get-node-start-index.js";

export const findContainingSortedLiteral = (
  sortedLiterals: ReadonlyArray<EsTreeNodeOfType<"Literal">>,
  startIndex: number,
  endIndex: number,
): EsTreeNodeOfType<"Literal"> | null => {
  if (endIndex < startIndex) return null;
  let lowerIndex = 0;
  let upperIndex = sortedLiterals.length;
  while (lowerIndex < upperIndex) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    const literal = sortedLiterals[middleIndex];
    if (!literal) return null;
    if (getNodeStartIndex(literal) <= startIndex) lowerIndex = middleIndex + 1;
    else upperIndex = middleIndex;
  }
  const literal = sortedLiterals[lowerIndex - 1];
  return literal && getNodeEndIndex(literal) >= endIndex ? literal : null;
};
