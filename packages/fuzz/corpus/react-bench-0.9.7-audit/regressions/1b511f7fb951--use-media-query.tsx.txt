// rule: effect-needs-cleanup
// file-path: src/hooks/useMediaQuery.tsx
// audit-verdict: pass
// weakness: react-bench-exact-callsite
// source: React Bench 0.9.7 exhaustive audit 1b511f7fb951ea327423b69bed6cd97f4bf97e17ba1b74c9e7dba47ccd0d1a38
import React from 'react';

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export const useMediaQuery = (breakpoint?: string): boolean => {
  const [matches, setMatches] = React.useState(false);

  useIsomorphicLayoutEffect(() => {
    if (!breakpoint || typeof window === 'undefined') {
      setMatches(false);
      return undefined;
    }

    let media: MediaQueryList;
    try {
      media = window.matchMedia(breakpoint);
    } catch {
      return undefined;
    }

    const handleMatch = () => setMatches(media.matches);

    // Sync in case the match changed between render and effect.
    handleMatch();

    if ('addEventListener' in media) {
      media.addEventListener('change', handleMatch);
    } else if ('addListener' in media) {
      (media as any).addListener(handleMatch);
    }

    return () => {
      if ('removeEventListener' in media) {
        media.removeEventListener('change', handleMatch);
      } else if ('removeListener' in media) {
        (media as any).removeListener(handleMatch);
      }
    };
  }, [breakpoint]);

  return matches;
};
