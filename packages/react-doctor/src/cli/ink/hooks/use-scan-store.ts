import { useSyncExternalStore } from "react";
import type { ScanStore, ScanStoreSnapshot } from "../scan-store.js";

export const useScanStore = (store: ScanStore): ScanStoreSnapshot =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
