// rule: rendering-hydration-no-flicker
// weakness: framework-gating
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

import { useEffect, useState } from "react";

export const ResourcePicker = () => {
  const [resolvedPath, setResolvedPath] = useState(null);

  useEffect(() => {
    setResolvedPath(null);
  }, []);

  return <output>{resolvedPath}</output>;
};
