// rule: no-hydration-branch-on-browser-global
// weakness: alias-guard
// source: synthetic server snapshot gate regression
import { useSyncExternalStore } from "react";

const useReady = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

export const StatusPanel = () => {
  const ready = useReady();
  if (!ready) return null;
  return typeof window !== "undefined" ? <main /> : <aside />;
};
