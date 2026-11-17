// rule: effect-needs-cleanup
// weakness: control-flow
// source: millionco/react-doctor#2447

import { useEffect } from "react";

export function StreamPoller({ onPoll }: { onPoll: () => void }) {
  useEffect(() => {
    const stream = new EventSource("/events");
    let timer: number | undefined;

    const beginPolling = () => {
      if (timer === undefined || force) timer = window.setInterval(onPoll, 1_000);
    };

    const endPolling = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };

    stream.addEventListener("error", beginPolling);
    stream.addEventListener("open", endPolling);

    return () => {
      stream.removeEventListener("error", beginPolling);
      stream.removeEventListener("open", endPolling);
      stream.close();
      endPolling();
    };
  }, [onPoll]);

  return null;
}
