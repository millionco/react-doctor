// rule: no-hydration-branch-on-browser-global
// weakness: alias-guard
// source: synthetic hook metadata write regression
import { useSyncExternalStore } from "react";

const useReady = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

useReady.description = "ready";

export const StatusPanel = () => {
  const ready = useReady();
  return ready && typeof window !== "undefined" ? <main /> : <aside />;
};
