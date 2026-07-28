import { useSyncExternalStore } from "react";

const primaryListeners = new Set<() => void>();
const secondaryListeners = new Set<() => void>();
let primaryVersion = 0;
let secondaryVersion = 0;

interface StoreReaderProperties {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

interface ApplicationProperties {
  useSecondarySnapshot: boolean;
  useSecondaryStore: boolean;
}

const StoreReader = ({ subscribe, getSnapshot }: StoreReaderProperties) => {
  const version = useSyncExternalStore(subscribe, getSnapshot);
  return <output>{version}</output>;
};

export const Application = ({ useSecondarySnapshot, useSecondaryStore }: ApplicationProperties) => {
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
      subscribe={useSecondaryStore ? subscribeToSecondary : subscribeToPrimary}
      getSnapshot={useSecondarySnapshot ? getSecondarySnapshot : getPrimarySnapshot}
    />
  );
};
