import { useSyncExternalStore } from "react";

const subscribe = (_listener: () => void) => () => undefined;

export const Status = () => {
  const status = useSyncExternalStore(subscribe, () => ({ online: true }));
  return <p>{status.online ? "online" : "offline"}</p>;
};
