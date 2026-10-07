// rule: no-hydration-branch-on-browser-global
// weakness: control-flow
// source: ReactBench hydration audit retractions

import { useMemo, useState } from "react";

export const Background = () => {
  const [mounted] = useState(false);
  const playable = useMemo(() => {
    if (typeof document === "undefined") return false;
    return Boolean(document.createElement("video"));
  }, []);
  return mounted && playable ? <video /> : <img alt="" />;
};
