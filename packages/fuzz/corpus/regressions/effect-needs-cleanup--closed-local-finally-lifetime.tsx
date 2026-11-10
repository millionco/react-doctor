// rule: effect-needs-cleanup
// weakness: control-flow
// source: synthetic public PR #1958 reconciliation
// verdict: pass

import { useEffect } from "react";

declare const notify: () => void;

export const ProtectedCleanup = () => {
  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };
  useEffect(() => {
    const stop = navigation.addListener("event", () => {});
    const secondStop = navigation.addListener("event", () => {});
    return () => {
      try {
        notify();
      } finally {
        stop();
        secondStop();
      }
    };
  }, [navigation]);
  return null;
};
