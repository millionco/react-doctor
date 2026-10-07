// rule: effect-needs-cleanup
// verdict: pass
// weakness: library-idiom
// source: react-bench write-react-azouaoui-med-react-pro-sidebar-267 6Z552od false positive

import React from "react";

const getServerSnapshot = () => false;
const noopUnsubscribe = () => undefined;

export const useMediaQuery = (breakpoint?: string): boolean => {
  const mediaQueryList = React.useMemo(
    () =>
      breakpoint && typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(breakpoint)
        : null,
    [breakpoint],
  );

  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      if (!mediaQueryList) return noopUnsubscribe;
      if (typeof mediaQueryList.addEventListener === "function") {
        mediaQueryList.addEventListener("change", onStoreChange);
        return () => mediaQueryList.removeEventListener("change", onStoreChange);
      }
      mediaQueryList.addListener(onStoreChange);
      return () => mediaQueryList.removeListener(onStoreChange);
    },
    [mediaQueryList],
  );

  const getSnapshot = React.useCallback(() => Boolean(mediaQueryList?.matches), [mediaQueryList]);

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
