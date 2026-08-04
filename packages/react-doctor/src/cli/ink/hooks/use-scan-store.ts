import type { ScanStore, ScanStoreSnapshot } from "../scan-store.js";
import { useSyncExternalStore } from "../react-runtime.js";

export const useScanStore = (store: ScanStore): ScanStoreSnapshot =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
