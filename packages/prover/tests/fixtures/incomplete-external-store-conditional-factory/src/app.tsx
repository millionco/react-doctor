import { useSyncExternalStore } from "react";

let primaryVersion = 0;
let secondaryVersion = 0;
const primaryListeners = new Set<() => void>();
const secondaryListeners = new Set<() => void>();

interface StoreReaderProperties {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

interface ApplicationProperties {
  readSecondaryStore: boolean;
  subscribeToSecondaryStore: boolean;
}

const selectCallback = <Callback,>(
  condition: boolean,
  whenTrue: Callback,
  whenFalse: Callback,
): Callback => (condition ? whenTrue : whenFalse);

const StoreReader = ({ subscribe, getSnapshot }: StoreReaderProperties) => {
  const version = useSyncExternalStore(subscribe, getSnapshot);
  return <output>{version}</output>;
};

export const Application = ({
  readSecondaryStore,
  subscribeToSecondaryStore,
}: ApplicationProperties) => {
  const subscribeToPrimary = (listener: () => void) => {
    primaryListeners.add(listener);
    return () => primaryListeners.delete(listener);
  };
  const subscribeToSecondary = (listener: () => void) => {
    secondaryListeners.add(listener);
    return () => secondaryListeners.delete(listener);
  };
  const getPrimarySnapshot = () => primaryVersion;
  const getSecondarySnapshot = () => secondaryVersion;
  return (
    <StoreReader
      subscribe={selectCallback(
        subscribeToSecondaryStore,
        subscribeToSecondary,
        subscribeToPrimary,
      )}
      getSnapshot={selectCallback(readSecondaryStore, getSecondarySnapshot, getPrimarySnapshot)}
    />
  );
};
