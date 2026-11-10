// rule: effect-needs-cleanup
// weakness: alias-guard
// source: synthetic public PR #1958 reconciliation
// verdict: pass

import { useEffect } from "react";

const register = (_event: string, _callback: () => void) => () => {};

export const StableRegistration = () => {
  const coveredNavigation = { addListener: register };
  useEffect(() => {
    const stop = coveredNavigation.addListener("event", () => {});
    return () => stop();
  }, [coveredNavigation]);
  return null;
};
