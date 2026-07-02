// rule: react-hooks/set-state-in-effect
// weakness: copy-tracking
// source: facebook/react#34858 (setState from ref-derived measurement in useLayoutEffect)
import { useLayoutEffect, useRef, useState } from "react";

export const Tooltip = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(0);

  useLayoutEffect(() => {
    const height = ref.current?.getBoundingClientRect().height ?? 0;
    setTooltipHeight(height);
  }, []);

  return <div ref={ref}>{tooltipHeight}</div>;
};

export const Foo = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [isWithinBar, setIsWithinBar] = useState(false);

  useLayoutEffect(() => {
    setIsWithinBar(ref.current?.closest(".bar") != null);
  }, []);

  return (
    <div ref={ref} className={isWithinBar ? "variant-1" : "variant-2"}>
      Foo
    </div>
  );
};
