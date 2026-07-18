// rule: effect-needs-cleanup
// weakness: conditional-delegated-disposer
// source: react-bench write-react-lobehub-lobe-ui VjSar55

import { useCallback, useSyncExternalStore } from "react";

interface Store {
  getSnapshot: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export const StoreValue = ({ store }: { store: Store | null }) => {
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(listener) : () => {}),
    [store],
  );
  const getSnapshot = useCallback(() => store?.getSnapshot() ?? false, [store]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return <span>{String(value)}</span>;
};
