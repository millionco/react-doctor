// rule: effect-needs-cleanup
// weakness: library-idiom
// source: React Bench ProSidebar write-react-azouaoui-med-react-pro-sidebar-267
import React from "react";

export const useMediaQuery = (breakpoint: string): boolean => {
  const subscribe = React.useCallback(
    (notify: () => void) => {
      const media = window.matchMedia(breakpoint);
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", notify);
        return () => media.removeEventListener("change", notify);
      }
      media.addListener(notify);
      return () => media.removeListener(notify);
    },
    [breakpoint],
  );
  const getSnapshot = React.useCallback(() => window.matchMedia(breakpoint).matches, [breakpoint]);
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
};
