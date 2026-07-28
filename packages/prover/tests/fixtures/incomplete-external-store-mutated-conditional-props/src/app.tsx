import { useSyncExternalStore } from "react";

let primaryVersion = 0;
let secondaryVersion = 0;
const primaryListeners = new Set<() => void>();
const secondaryListeners = new Set<() => void>();

interface StoreReaderProperties {
  ignored: boolean;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

interface ApplicationProperties {
  useSecondaryStore: boolean;
}

const StoreReader = ({ ignored, subscribe, getSnapshot }: StoreReaderProperties) => {
  const version = useSyncExternalStore(subscribe, getSnapshot);
  return <output data-ignored={ignored}>{version}</output>;
};

export const Application = ({ useSecondaryStore }: ApplicationProperties) => {
  let selectedStoreIsSecondary = useSecondaryStore;
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
      subscribe={selectedStoreIsSecondary ? subscribeToSecondary : subscribeToPrimary}
      ignored={(selectedStoreIsSecondary = !selectedStoreIsSecondary)}
      getSnapshot={selectedStoreIsSecondary ? getSecondarySnapshot : getPrimarySnapshot}
    />
  );
};
