// rule: no-chain-state-updates
// weakness: wrapper-transparency
// source: authored direct-helper self-sync regression
// react-major: 16
// verdict: pass

import { useEffect, useState } from "react";

export const Selection = () => {
  const [position, setPosition] = useState(0);
  const reset = () => {
    const fallback = -1;
    const next = fallback;
    setPosition(next);
  };

  useEffect(() => {
    if (position > 0) reset();
  }, [position]);

  return <button onClick={() => setPosition(1)}>{position}</button>;
};
