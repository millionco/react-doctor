// rule: effect-needs-cleanup
// weakness: control-flow
// source: synthetic control for public issue #1956
// verdict: fail

import { useEffect } from "react";

interface Navigation {
  addListener: (event: "transitionEnd", callback: () => void) => () => void;
}

declare function useNavigation(): Navigation;

export const ConditionalCleanup = ({ shouldRelease }: { shouldRelease: boolean }) => {
  const coveredNavigation = useNavigation();
  useEffect(() => {
    const unsubscribe = coveredNavigation.addListener("transitionEnd", () => {});
    return () => {
      if (shouldRelease) unsubscribe();
    };
  }, [coveredNavigation, shouldRelease]);
  return null;
};
