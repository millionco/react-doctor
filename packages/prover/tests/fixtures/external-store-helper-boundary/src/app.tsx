import { useSyncExternalStore } from "react";

let language = "en";
const listeners = new Set<() => void>();

const addListener = (listener: () => void) => {
  listeners.add(listener);
};

const subscribe = (listener: () => void) => {
  addListener(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => language;

export const Language = () => {
  const currentLanguage = useSyncExternalStore(subscribe, getSnapshot);
  return <p>{currentLanguage}</p>;
};
