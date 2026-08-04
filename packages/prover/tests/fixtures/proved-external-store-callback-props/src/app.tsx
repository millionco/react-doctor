import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

interface StoreReaderProperties {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
  getServerSnapshot: () => number;
}

const StoreReader = ({ subscribe, getSnapshot, getServerSnapshot }: StoreReaderProperties) => {
  const currentVersion = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return <output>{currentVersion}</output>;
};

export const Application = () => {
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = () => version;
  return (
    <StoreReader subscribe={subscribe} getSnapshot={getSnapshot} getServerSnapshot={getSnapshot} />
  );
};
