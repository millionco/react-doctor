import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

interface StoreReaderProperties {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

const StoreReader = ({ subscribe, getSnapshot }: StoreReaderProperties) => {
  const version = useSyncExternalStore(subscribe, getSnapshot);
  return <output>{version}</output>;
};

export const Application = () => {
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = () => 0;
  const storeProperties = { subscribe, getSnapshot };
  return <StoreReader {...storeProperties} />;
};
