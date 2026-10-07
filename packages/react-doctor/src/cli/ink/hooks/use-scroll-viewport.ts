import { useInput } from "ink";
import { TUI_HALF_PAGE_DIVISOR } from "../../utils/constants.js";
import { clampNumber } from "../../utils/clamp-number.js";
import { resolveVisibleStart } from "../../utils/resolve-visible-start.js";
import { useRef, useState } from "../react-runtime.js";

export interface ScrollViewport {
  readonly selectedIndex: number;
  readonly visibleStart: number;
  readonly visibleEnd: number;
}

export interface UseScrollViewportOptions {
  readonly itemCount: number;
  readonly height: number;
  readonly initialSelectedIndex?: number;
  readonly isActive?: boolean;
  readonly isSelectable?: (index: number) => boolean;
  readonly onSelectedIndexChange?: (index: number) => void;
}

export const useScrollViewport = (options: UseScrollViewportOptions): ScrollViewport => {
  const {
    itemCount,
    height,
    initialSelectedIndex = 0,
    isActive = true,
    isSelectable,
    onSelectedIndexChange,
  } = options;

  const canSelect = (index: number): boolean =>
    index >= 0 && index < itemCount && (isSelectable ? isSelectable(index) : true);

  const seekSelectable = (start: number, step: number): number => {
    for (let index = start; index >= 0 && index < itemCount; index += step) {
      if (canSelect(index)) return index;
    }
    return -1;
  };

  const nearestSelectable = (target: number, step: number): number => {
    const ahead = seekSelectable(target, step);
    if (ahead !== -1) return ahead;
    const behind = seekSelectable(target, -step);
    return behind === -1 ? target : behind;
  };

  const [selectedIndex, setSelectedIndex] = useState(() => {
    const first = seekSelectable(clampNumber(initialSelectedIndex, 0, itemCount - 1), 1);
    return first === -1 ? 0 : first;
  });
  const [offset, setOffset] = useState(0);
  const awaitingSecondG = useRef(false);

  const moveTo = (rawIndex: number, step: number): void => {
    const nextSelectedIndex = nearestSelectable(clampNumber(rawIndex, 0, itemCount - 1), step);
    setSelectedIndex(nextSelectedIndex);
    onSelectedIndexChange?.(nextSelectedIndex);
    setOffset((currentOffset) => {
      if (nextSelectedIndex < currentOffset) return nextSelectedIndex;
      if (nextSelectedIndex >= currentOffset + height) {
        return nextSelectedIndex - height + 1;
      }
      return currentOffset;
    });
  };

  useInput(
    (input, key) => {
      if (itemCount === 0) return;
      const isSecondG = awaitingSecondG.current && input === "g";
      if (input !== "g") awaitingSecondG.current = false;

      if (key.downArrow || input === "j") return moveTo(selectedIndex + 1, 1);
      if (key.upArrow || input === "k") return moveTo(selectedIndex - 1, -1);
      if (key.pageDown) return moveTo(selectedIndex + height, 1);
      if (key.pageUp) return moveTo(selectedIndex - height, -1);
      if (key.ctrl && input === "d") {
        return moveTo(selectedIndex + Math.floor(height / TUI_HALF_PAGE_DIVISOR), 1);
      }
      if (key.ctrl && input === "u") {
        return moveTo(selectedIndex - Math.floor(height / TUI_HALF_PAGE_DIVISOR), -1);
      }
      if (input === "G") return moveTo(itemCount - 1, -1);
      if (isSecondG) {
        awaitingSecondG.current = false;
        return moveTo(0, 1);
      }
      if (input === "g") {
        awaitingSecondG.current = true;
      }
    },
    { isActive },
  );

  const resolvedSelected = canSelect(selectedIndex)
    ? selectedIndex
    : nearestSelectable(clampNumber(selectedIndex, 0, itemCount - 1), 1);
  const visibleStart = resolveVisibleStart({
    itemCount,
    offset,
    selectedIndex: resolvedSelected,
    viewportHeight: height,
  });
  return {
    selectedIndex: resolvedSelected,
    visibleStart,
    visibleEnd: Math.min(itemCount, visibleStart + height),
  };
};
