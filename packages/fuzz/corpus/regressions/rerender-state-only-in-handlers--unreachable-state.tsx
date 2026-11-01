// rule: rerender-state-only-in-handlers
// weakness: control-flow
// source: synthetic unreachable declaration control
// verdict: pass
import { useState } from "react";
export const Panel = () => {
  return <main />;
  const [saved, setSaved] = useState(false);
  return <button onClick={() => setSaved(true)}>Save</button>;
};
