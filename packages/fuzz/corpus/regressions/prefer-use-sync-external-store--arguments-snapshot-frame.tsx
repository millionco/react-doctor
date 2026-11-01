// rule: prefer-use-sync-external-store
// verdict: pass
// weakness: snapshot-frame-context
// source: independent synthetic regression

import { useEffect, useState } from "react";
export function useViewportWidth() {
  const [width, setWidth] = useState(arguments[0]);
  useEffect(() => {
    function onResize() {
      setWidth(arguments[0]);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}
