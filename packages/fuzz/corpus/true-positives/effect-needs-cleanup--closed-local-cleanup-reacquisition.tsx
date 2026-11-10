// rule: effect-needs-cleanup
// weakness: control-flow
// source: synthetic public PR #1958 reconciliation
// verdict: fail

import { useEffect } from "react";

export const ReacquiringCleanup = () => {
  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };
  useEffect(() => {
    const stop = navigation.addListener("event", () => {});
    return () => {
      stop();
      navigation.addListener("event", () => {});
    };
  }, [navigation]);
  return null;
};
