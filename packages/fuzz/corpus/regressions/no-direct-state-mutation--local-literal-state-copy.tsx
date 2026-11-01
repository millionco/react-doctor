// rule: no-direct-state-mutation
// weakness: alias-guard
// source: independent synthetic local literal initializer
// verdict: pass
import { useState } from "react";

export const Counter = () => {
  const initial = { count: 0 };
  const [snapshot, setSnapshot] = useState(initial);
  return (
    <button onClick={() => setSnapshot((previous) => ({ ...previous, count: 1 }))}>
      {snapshot.count}
    </button>
  );
};
