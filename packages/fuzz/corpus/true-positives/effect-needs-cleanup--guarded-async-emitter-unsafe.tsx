// rule: effect-needs-cleanup
// weakness: control-flow
// source: millionco/react-doctor#2446

import { useEffect } from "react";

declare const emitter: {
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
};
declare function ready(): Promise<void>;

export function AsyncSubscribe() {
  useEffect(() => {
    let cancelled = false;
    const listener = () => {};

    const subscribe = async () => {
      await ready();
      if (cancelled) return;
      await ready();
      emitter.on("change", listener);
    };
    void subscribe();

    return () => {
      cancelled = true;
      emitter.off("change", listener);
    };
  }, []);
  return null;
}
