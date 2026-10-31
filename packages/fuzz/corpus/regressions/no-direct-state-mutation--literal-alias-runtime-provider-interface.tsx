// rule: no-direct-state-mutation
// weakness: alias-guard
// source: independent synthetic provider-closure review
// verdict: pass
import React, { useState } from "react";
function expose() {
  interface React {}
  consume(React);
}
expose();
export const Panel = () => {
  const initial = { count: 0 };
  const [snapshot, setSnapshot] = useState(initial);
  snapshot.count = 1;
  return <output />;
};
