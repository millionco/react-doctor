import { useEffect } from "react";

export const Tracker = ({ first, second }: { first: Element; second: Element }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    observer["observe"](first);
    observer[`observe`](second);
    return () => observer["unobserve"](first);
  }, [first, second]);
  return null;
};
