// rule: effect-needs-cleanup
// verdict: fail
// weakness: identity-provenance
// source: adversarial review of memoized MediaQueryList cleanup ownership

import React from "react";

export const CustomMemoizedListener = ({ customBus, shouldUseMediaQuery }) => {
  const memoizedBus = React.useMemo(() => {
    let bus = customBus;
    if (shouldUseMediaQuery) {
      bus = window.matchMedia("(prefers-color-scheme: dark)");
    }
    return bus;
  }, [customBus, shouldUseMediaQuery]);

  const subscribe = React.useCallback(
    (handle) => {
      memoizedBus.addListener(handle);
      return () => memoizedBus.removeListener(handle);
    },
    [memoizedBus],
  );

  return React.useSyncExternalStore(subscribe, getSnapshot);
};
