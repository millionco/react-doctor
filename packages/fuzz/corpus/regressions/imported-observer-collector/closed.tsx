// rule: effect-observer-needs-disconnect
// weakness: cross-file
// source: synthetic closed callback collector
// verdict: pass
// file-path: corpus/regressions/imported-observer-collector/closed.tsx
import { useEffect } from "react";
import { makeBucket } from "./collector";
export const View = ({ element }: { element: Element }) => {
  useEffect(() => {
    const bucket = makeBucket();
    const observer = new ResizeObserver(() => {});
    observer.observe(element);
    bucket.keep(() => observer.disconnect());
    return () => bucket.flush();
  }, [element]);
  return null;
};
