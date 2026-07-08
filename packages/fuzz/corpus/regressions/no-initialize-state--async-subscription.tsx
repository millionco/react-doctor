// rule: no-initialize-state
// weakness: control-flow
// source: Claude Code session (user had to add a disable comment; state starts
// false by design and flips asynchronously when the element scrolls into view)
import { useEffect, useRef, useState } from "react";

export const LazySection = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShown(Boolean(entry?.isIntersecting)),
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return <div ref={containerRef}>{shown ? "visible" : "pending"}</div>;
};
