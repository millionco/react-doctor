import { flushSync } from "react-dom";

interface Store {
  select: (name: string) => void;
}

export const updateSelection = (store: Store): void => {
  flushSync(() => setText(readRemoteText()));
  store.select("activeDocument");
};
