// rule: rendering-hydration-no-flicker
// weakness: copy-tracking
// source: 0.8.1-to-main all-rules parity independent audit
// verdict: pass

import { useEffect, useState } from "react";

export const AccessibleControl = () => {
  const [mounted, setMounted] = useState(false);
  const generatedId = mounted ? "mounted-description" : "server-description";
  const accessibilityId = generatedId;

  useEffect(() => {
    setMounted(true);
  }, []);

  return <input aria-describedby={accessibilityId} />;
};
