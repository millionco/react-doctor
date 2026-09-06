// rule: rerender-state-only-in-handlers
// weakness: optional member dependencies still consume imperative instance state
// source: handwritten native parity regression
// verdict: pass

import { useEffect, useState } from "react";

export const Player = () => {
  const [controller, setController] = useState(null);
  useEffect(() => {
    controller?.start();
  }, [controller?.start]);
  return <Widget onReady={setController} />;
};
