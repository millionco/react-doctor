// rule: rendering-hydration-no-flicker
// weakness: wrapper-transparency
// source: 0.8.1-to-main all-rules parity independent audit
// verdict: pass

import { useEffect, useState } from "react";

export const StablePanel = () => {
  const [isVisible, setIsVisible] = useState(() => false);

  useEffect(() => {
    setIsVisible(false);
  }, []);

  return isVisible ? <Panel /> : null;
};
