// rule: no-set-state-after-await-in-effect
// verdict: fail
// weakness: control-flow
// source: independently authored synthetic post-await finalizer write
import { useEffect, useState } from "react";

export const Panel = ({ revision, load }) => {
  const [status, setStatus] = useState("");
  useEffect(() => {
    const run = async () => {
      try {
        await load();
        return;
      } finally {
        setStatus("late");
      }
    };
    run();
  }, [revision, load]);
  return <div>{status}</div>;
};
