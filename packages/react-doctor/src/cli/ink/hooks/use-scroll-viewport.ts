import { useInput } from "ink";
import { useRef, useState } from "react";
import { TUI_HALF_PAGE_DIVISOR } from "../../utils/constants.js";

export interface ScrollViewport {
  readonly selectedIndex: number;
  readonly visibleStart: number;
  readonly visibleEnd: number;
}

export interface UseScrollViewportOptions {
  readonly itemCount: number;
  readonly height: number;
  readonly isActive?: boolean;
  readonly isSelectable?: (index: number) => boolean;
}

export const useScrollViewport = (options: UseScrollViewportOptions): ScrollViewport => {
  const { itemCount, height, isActive = true, isSelectable } = options;

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
    const first = seekSelectable(0, 1);
    return first === -1 ? 0 : first;
  });
  const [offset, setOffset] = useState(0);
  const awaitingSecondG = useRef(false);

  const clampIndex = (index: number): number => Math.max(0, Math.min(itemCount - 1, index));

  const moveTo = (rawIndex: number, step: number): void => {
    const next = nearestSelectable(clampIndex(rawIndex), step);
    setSelectedIndex(next);
    setOffset((current) => {
      if (next < current) return next;
      if (next >= current + height) return next - height + 1;
      return current;
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

  const maxOffset = Math.max(0, itemCount - height);
  const visibleStart = Math.min(offset, maxOffset);
  const resolvedSelected = canSelect(selectedIndex)
    ? selectedIndex
    : nearestSelectable(clampIndex(selectedIndex), 1);
  return {
    selectedIndex: resolvedSelected,
    visibleStart,
    visibleEnd: Math.min(itemCount, visibleStart + height),
  };
};
