// rule: no-chain-state-updates
// weakness: wrapper-transparency
// source: authored mixed-helper state-chain control
// react-major: 16
// verdict: fail

import { useEffect, useState } from "react";

export const Selection = () => {
  const [position, setPosition] = useState(0);
  const [shown, setShown] = useState(true);
  const reset = () => {
    setPosition(-1);
    setShown(false);
  };

  useEffect(() => {
    if (position > 0) reset();
  }, [position]);

  return <button onClick={() => setPosition(1)}>{shown ? position : "closed"}</button>;
};
