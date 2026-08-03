// rule: no-controlled-selection-focus-effect
// verdict: fail
// source: Floating UI controlled selectedIndex focus regression
import { useModernLayoutEffect } from "./use-modern-layout-effect";

export const useListNavigation = ({ selectedIndex, focusItem, listRef }) => {
  const indexRef = useRef(null);
  useModernLayoutEffect(() => {
    indexRef.current = selectedIndex;
    focusItem(listRef, indexRef);
  }, [focusItem, listRef, selectedIndex]);
};
