// rule: no-hydration-branch-on-browser-global
// verdict: pass
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
const useReady = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
const browser = () => typeof window !== "undefined" && window.innerWidth > 500;
export function View({ allow = false }) {
  const ready = useReady();
  if (!ready) return null;
  return browser() ? <video /> : <img />;
}
