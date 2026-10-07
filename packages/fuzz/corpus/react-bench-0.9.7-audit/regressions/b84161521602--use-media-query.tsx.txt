// rule: effect-needs-cleanup
// file-path: src/hooks/useMediaQuery.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit b84161521602cd1cdb82201ec9c3ed32dea4c388233953caa0345864a9adf710
import React from 'react';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export const useMediaQuery = (query?: string): boolean => {
  const [matches, setMatches] = React.useState(false);
  const queryRef = React.useRef<string | undefined>(query);

  useIsomorphicLayoutEffect(() => {
    // When query is removed, ensure we discard stale true
    if (!query) {
      queryRef.current = query;
      setMatches((prev) => (prev ? false : prev));
      return undefined;
    }

    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      queryRef.current = query;
      return undefined;
    }

    const media = window.matchMedia(query);
    queryRef.current = query;

    const getMatches = (ev?: MediaQueryListEvent | MediaQueryList) => {
      if (ev && typeof ev === 'object' && 'matches' in ev) {
        return ev.matches;
      }
      return media.matches;
    };

    const handleChange = (ev?: MediaQueryListEvent | MediaQueryList) => {
      setMatches(getMatches(ev));
    };

    // Sync before paint
    handleChange();

    // Modern API
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange as EventListener);
      return () => media.removeEventListener('change', handleChange as EventListener);
    }

    // Legacy fallback for Safari <14
    const legacy = media as unknown as {
      addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
    };

    if (legacy.addListener && legacy.removeListener) {
      legacy.addListener(handleChange as (e: MediaQueryListEvent) => void);
      return () => legacy.removeListener!(handleChange as (e: MediaQueryListEvent) => void);
    }

    return undefined;
  }, [query]);

  // Discard stale match state synchronously when query changes or is removed
  if (queryRef.current !== query) {
    return false;
  }

  return matches;
};
