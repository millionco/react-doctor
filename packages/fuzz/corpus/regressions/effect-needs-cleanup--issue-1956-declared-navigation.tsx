// rule: effect-needs-cleanup
// weakness: name-heuristic
// source: https://github.com/millionco/react-doctor/issues/1956
// verdict: pass

import { useEffect } from "react";

interface Navigation {
  addListener: (event: "transitionEnd", callback: () => void) => () => void;
}

declare function useNavigation(): Navigation;

export const RenamedReceiver = () => {
  const coveredNavigation = useNavigation();
  useEffect(() => {
    const unsubscribe = coveredNavigation.addListener("transitionEnd", () => {});
    return () => {
      unsubscribe();
    };
  }, [coveredNavigation]);
  return null;
};
