// rule: no-direct-state-mutation
// weakness: alias-guard
// source: independent synthetic local literal initializer
// verdict: fail
import { useState } from "react";

export const Counter = () => {
  const initial = { count: 0 };
  const [snapshot, setSnapshot] = useState(initial);
  const update = () => {
    snapshot.count = 1;
    setSnapshot({ ...snapshot });
  };
  return <button onClick={update}>{snapshot.count}</button>;
};
