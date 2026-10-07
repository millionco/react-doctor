// rule: rendering-hydration-no-flicker
// weakness: name-heuristic
// source: 0.8.1-to-main all-rules parity independent audit
// verdict: fail

import { useEffect, useState } from "react";

export const DeferredPanel = () => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return <Panel entering={mounted ? FadeIn : undefined} />;
};
