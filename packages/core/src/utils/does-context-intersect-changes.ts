import type { ChangedFileLineRanges } from "../types/index.js";

export interface ChangedContext {
  readonly range: readonly [number, number];
  readonly excludedRanges?: ReadonlyArray<readonly [number, number]>;
}

interface ContextIntersectionInput {
  readonly contexts: ReadonlyArray<ChangedContext>;
  readonly changes: ChangedFileLineRanges;
}

export const doesContextIntersectChanges = ({
  contexts,
  changes,
}: ContextIntersectionInput): boolean =>
  contexts.some(({ range: [startLine, endLine], excludedRanges = [] }) => {
    for (const [changedStart, changedEnd] of changes.ranges) {
      let remainingStart = Math.max(startLine, changedStart);
      const remainingEnd = Math.min(endLine, changedEnd);
      for (const [childStart, childEnd] of excludedRanges) {
        if (childEnd < remainingStart) continue;
        if (childStart > remainingEnd) break;
        if (childStart > remainingStart) return true;
        remainingStart = Math.max(remainingStart, childEnd + 1);
      }
      if (remainingStart <= remainingEnd) return true;
    }
    return (changes.deletionLines ?? []).some(
      (deletionLine) =>
        deletionLine >= startLine &&
        deletionLine < endLine &&
        !excludedRanges.some(
          ([childStart, childEnd]) => deletionLine >= childStart && deletionLine < childEnd,
        ),
    );
  });
