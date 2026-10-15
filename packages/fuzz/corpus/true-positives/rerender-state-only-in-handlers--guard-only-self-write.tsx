// rule: rerender-state-only-in-handlers
// weakness: alias-guard
// source: synthetic guard-only self-write
// verdict: fail
import { useEffect, useState } from "react";

interface SignalProps {
  flush: () => void;
}

export const SignalPanel = ({ flush }: SignalProps) => {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (pending) {
      flush();
      setPending(false);
    }
  }, [pending, flush]);
  useEffect(() => {
    if (0n) console.log(pending);
  }, [pending]);
  return <button onClick={() => setPending(true)}>Send</button>;
};
