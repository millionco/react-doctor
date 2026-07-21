// rule: rendering-hydration-no-flicker
// weakness: alias-guard
// source: 0.8.1-to-main all-rules final adversarial audit

import { useEffect as useMountEffect, useState } from "react";

export const ClientPanel = () => {
  const [mounted, setMounted] = useState(false);

  useMountEffect(() => {
    setMounted(true);
  }, []);

  return mounted ? <Panel /> : null;
};
