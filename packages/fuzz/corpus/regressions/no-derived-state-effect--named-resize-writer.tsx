// rule: no-derived-state-effect
// verdict: pass
// weakness: lifecycle
// source: synthetic counter with a named native resize writer

import { useEffect, useState } from "react";

export function Counter({ source }: { source: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- This fixture exercises the state-copy diagnostic.
    setCount(source);
  }, [source]);
  useEffect(() => {
    const listener = () => setCount((previous) => previous + 1);
    window.addEventListener("resize", listener);
    return () => window.removeEventListener("resize", listener);
  }, []);
  return <span>{count}</span>;
}
