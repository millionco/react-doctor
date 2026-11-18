// rule: no-derived-state
// weakness: control-flow
// source: synthetic
// verdict: pass
import { useEffect, useState } from "react";

export const useSection = (node: Element, initial: number) => {
  const [ratio, setRatio] = useState({ value: initial });
  useEffect(() => {
    const observer = new IntersectionObserver((records) => {
      setRatio({ value: records.length });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  useEffect(() => {
    setRatio({ value: initial });
  }, [initial]);
  return ratio;
};
