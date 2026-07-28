import { useSyncExternalStore } from "react";

let language = "en";
const listeners = new Set<() => void>();

export const setLanguage = (nextLanguage: string) => {
  language = nextLanguage;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => language;

export const Language = () => {
  const currentLanguage = useSyncExternalStore(subscribe, getSnapshot);
  return <p>{currentLanguage}</p>;
};
