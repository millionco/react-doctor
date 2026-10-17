// rule: effect-observer-needs-disconnect
// weakness: cross-file
// source: synthetic closed callback collector
// verdict: fail
// file-path: corpus/regressions/imported-observer-collector/earlier-throw.tsx
import { useEffect } from "react";
import { makeBucket } from "./collector";
export const View = ({ element }: { element: Element }) => {
  useEffect(() => {
    const bucket = makeBucket();
    bucket.keep(() => {
      throw new Error("synthetic unavailable");
    });
    const observer = new ResizeObserver(() => {});
    observer.observe(element);
    bucket.keep(() => observer.disconnect());
    return () => bucket.flush();
  }, [element]);
  return null;
};
