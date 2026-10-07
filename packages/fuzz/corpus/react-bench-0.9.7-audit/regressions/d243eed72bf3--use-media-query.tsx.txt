// rule: effect-needs-cleanup
// file-path: src/hooks/useMediaQuery.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit d243eed72bf3f17a3167c8a4de2b76b8db3e6715a8508f38240b3f6181a67904
import React from 'react';

const getServerSnapshot = () => false;

const subscribeToNothing = () => () => undefined;

export const useMediaQuery = (breakpoint?: string): boolean => {
  const getSnapshot = React.useCallback(() => {
    if (!breakpoint || typeof window === 'undefined' || !window.matchMedia) return false;

    return window.matchMedia(breakpoint).matches;
  }, [breakpoint]);

  const subscribe = React.useCallback(
    (notify: () => void) => {
      if (!breakpoint || typeof window === 'undefined' || !window.matchMedia) {
        return subscribeToNothing();
      }

      const media = window.matchMedia(breakpoint);
      const handleMatch = () => notify();

      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', handleMatch);
        return () => media.removeEventListener('change', handleMatch);
      }

      // Older browsers expose the original MediaQueryList listener API only.
      media.addListener(handleMatch);
      return () => media.removeListener(handleMatch);
    },
    [breakpoint],
  );

  return React.useSyncExternalStore(
    breakpoint ? subscribe : subscribeToNothing,
    getSnapshot,
    getServerSnapshot,
  );
};
