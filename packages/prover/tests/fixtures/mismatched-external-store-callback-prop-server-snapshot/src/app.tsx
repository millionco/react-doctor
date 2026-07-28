import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

interface StoreReaderProperties {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => boolean;
  getServerSnapshot: () => boolean;
}

const StoreReader = ({ subscribe, getSnapshot, getServerSnapshot }: StoreReaderProperties) => {
  const isReady = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return <output>{isReady ? "ready" : "waiting"}</output>;
};

export const Application = () => {
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = () => true;
  const getServerSnapshot = () => false;
  return (
    <StoreReader
      subscribe={subscribe}
      getSnapshot={getSnapshot}
      getServerSnapshot={getServerSnapshot}
    />
  );
};
