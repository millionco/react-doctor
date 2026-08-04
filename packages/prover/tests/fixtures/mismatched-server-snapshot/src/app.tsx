import { useSyncExternalStore } from "react";

const subscribe = (_listener: () => void) => () => undefined;

export const Connection = () => {
  const isOnline = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return <p>{isOnline ? "online" : "offline"}</p>;
};
