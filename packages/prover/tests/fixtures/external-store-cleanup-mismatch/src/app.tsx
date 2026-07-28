import { useSyncExternalStore } from "react";

const activeListeners = new Set<() => void>();
const unrelatedListeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  activeListeners.add(listener);
  return () => unrelatedListeners.delete(listener);
};

export const Version = () => {
  const version = useSyncExternalStore(subscribe, () => 1);
  return <p>{version}</p>;
};
