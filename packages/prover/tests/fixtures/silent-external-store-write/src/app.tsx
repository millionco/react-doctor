import { useSyncExternalStore } from "react";

let language = "en";
const listeners = new Set<() => void>();

export const setLanguage = (nextLanguage: string) => {
  language = nextLanguage;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const Language = () => {
  const currentLanguage = useSyncExternalStore(subscribe, () => language);
  return <p>{currentLanguage}</p>;
};
