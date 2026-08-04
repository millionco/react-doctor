import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

interface StoreReaderProperties {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => { version: number };
}

const StoreReader = ({ subscribe, getSnapshot }: StoreReaderProperties) => {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  return <output>{snapshot.version}</output>;
};

export const Application = () => {
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = () => ({ version: 0 });
  return <StoreReader subscribe={subscribe} getSnapshot={getSnapshot} />;
};
