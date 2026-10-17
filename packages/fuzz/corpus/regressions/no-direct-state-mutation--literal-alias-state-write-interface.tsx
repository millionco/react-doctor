// rule: no-direct-state-mutation
// weakness: alias-guard
// source: independent synthetic provider-closure review
// verdict: fail
import { useState } from "react";
export const Panel = () => {
  const initial = { count: 0 };
  const [snapshot, setSnapshot] = useState(initial);
  function update() {
    interface snapshot {}
    snapshot.count = 1;
  }
  update();
  return <output />;
};
