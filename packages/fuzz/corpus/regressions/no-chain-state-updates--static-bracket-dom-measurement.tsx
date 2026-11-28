// rule: no-chain-state-updates
// verdict: pass
// weakness: wrapper-transparency
// source: synthetic effect measuring a mounted HTML element through a quoted property

import { useEffect, useRef, useState } from "react";

export const Panel = () => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!viewportRef.current) return;
    setWidth(viewportRef.current["scrollWidth"]);
  }, [mode]);
  return (
    <div ref={viewportRef} onClick={() => setMode(!mode)}>
      {width}
    </div>
  );
};
