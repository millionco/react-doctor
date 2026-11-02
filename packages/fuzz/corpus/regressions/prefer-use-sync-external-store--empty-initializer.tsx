// rule: prefer-use-sync-external-store
// weakness: empty-initializer
// source: minimized scanner crash

import { useState, useSyncExternalStore } from "react";

let snapshot = "idle";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => snapshot;

export const Panel = () => {
  const [selection, setSelection] = useState<string>();
  const status = useSyncExternalStore(subscribe, getSnapshot);
  return <button onClick={() => setSelection(status)}>{selection}</button>;
};
