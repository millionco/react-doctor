// rule: forwarded-set-state-in-effect
// weakness: alias-guard
// source: React's documented ref measurement remains allowed through a setter helper
// verdict: pass
import { useLayoutEffect, useRef, useState } from "react";

const assign = <T,>(setter: (value: T) => void, value: T) => setter(value);

export const Tooltip = () => {
  const elementRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const bounds = elementRef.current!.getBoundingClientRect();
    const { height: measuredHeight } = bounds;
    assign(setHeight, measuredHeight);
  }, []);
  return <div ref={elementRef} style={{ height }} />;
};
