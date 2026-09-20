// verdict: pass
// rule: effect-needs-cleanup
// weakness: copy-tracking
// source: replacement-timer-cleanup pinned overlay audit, minimized
import { useEffect } from "react";

export const CursorOverlay = ({ enabled, selector, repositionCursor }) => {
  useEffect(() => {
    if (!enabled) return;
    let scrollResetTimer: ReturnType<typeof setTimeout> | undefined;

    const reposition = () => {
      if (selector) {
        try {
          const element = document.querySelector(selector);
          if (element) {
            repositionCursor(element.getBoundingClientRect());
            clearTimeout(scrollResetTimer);
            scrollResetTimer = setTimeout(() => repositionCursor(null), 150);
            return;
          }
        } catch (error) {
          console.debug(error);
        }
      }
      repositionCursor(null);
      clearTimeout(scrollResetTimer);
      scrollResetTimer = setTimeout(() => repositionCursor(null), 150);
    };

    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      clearTimeout(scrollResetTimer);
    };
  }, [enabled, selector, repositionCursor]);
  return null;
};
