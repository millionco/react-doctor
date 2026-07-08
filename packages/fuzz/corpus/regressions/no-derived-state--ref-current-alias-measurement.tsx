// rule: no-derived-state
// weakness: ref-current-alias
// source: RDE fizz run (posthog CollapsibleContent — layout read through a local alias)
import { useEffect, useRef, useState } from "react";

export const CollapsibleContent = ({
  maxHeight,
  children,
}: {
  maxHeight: number;
  children: React.ReactNode;
}) => {
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      setIsOverflowing(el.scrollHeight > maxHeight);
    }
  }, [children, maxHeight]);
  return (
    <div ref={contentRef} data-overflowing={isOverflowing}>
      {children}
    </div>
  );
};
