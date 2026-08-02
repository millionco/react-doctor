import { clampNumber } from "./clamp-number.js";

export interface ResolveVisibleStartInput {
  readonly itemCount: number;
  readonly offset: number;
  readonly selectedIndex: number;
  readonly viewportHeight: number;
}

export const resolveVisibleStart = ({
  itemCount,
  offset,
  selectedIndex,
  viewportHeight,
}: ResolveVisibleStartInput): number => {
  if (viewportHeight <= 0) return 0;
  const maximumOffset = Math.max(0, itemCount - viewportHeight);
  const boundedOffset = clampNumber(offset, 0, maximumOffset);
  if (selectedIndex < boundedOffset) return selectedIndex;
  if (selectedIndex >= boundedOffset + viewportHeight) {
    return Math.max(0, selectedIndex - viewportHeight + 1);
  }
  return boundedOffset;
};
