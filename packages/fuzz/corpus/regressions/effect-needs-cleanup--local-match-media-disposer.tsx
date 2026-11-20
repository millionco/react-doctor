// rule: effect-needs-cleanup
// verdict: pass

import { useCallback, useSyncExternalStore } from "react";

const readPreference = (query: string) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
};

export function usePreference(query: string) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const result = readPreference(query);
      if (!result) return () => undefined;
      const legacy = result as Pick<MediaQueryList, "addListener" | "removeListener">;
      legacy.addListener(notify);
      return () => legacy.removeListener?.(notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => readPreference(query)?.matches ?? false,
    () => false,
  );
}
