// rule: effect-observer-needs-disconnect
// verdict: fail
// weakness: provider-erasure
// source: synthetic
import { useEffect } from "react";
import { makeBucket } from "./namespace-observer-collector/collector";
export const View = ({ element }) => {
  useEffect(() => {
    const bucket = makeBucket();
    const observer = new ResizeObserver(() => {});
    observer.observe(element);
    bucket.keep(() => observer.disconnect());
    return () => bucket.flush();
  }, []);
  return null;
};
