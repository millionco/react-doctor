// rule: no-hydration-branch-on-browser-global
// weakness: control-flow
// source: synthetic native snapshot loop completion
// verdict: fail
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export const SnapshotPanel = () => {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!ready) {
    do {
      try {
        return null;
      } finally {
        break;
      }
    } while (false);
  }
  return typeof window === "undefined" ? <aside /> : <main />;
};
