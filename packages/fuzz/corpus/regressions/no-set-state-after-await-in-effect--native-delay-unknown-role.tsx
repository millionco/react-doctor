// rule: no-set-state-after-await-in-effect
// verdict: fail
// weakness: framework-gating
// source: independently authored synthetic native-delay role boundary
import { useEffect, useState } from "react";

const pause = (milliseconds, signal) =>
  new Promise((settle) => {
    if (signal.aborted) {
      settle(false);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      settle(true);
    }, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      settle(false);
    };
    signal.addEventListener("abort", cancel, { once: true });
  });

export const Panel = ({ revision }) => {
  const [status, setStatus] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      if (!(await pause(24, controller.signal))) return;
      setStatus("ready");
    };
    run();
    return () => controller.abort();
  }, [revision]);
  return <div>{status}</div>;
};
