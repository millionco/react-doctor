import { useEffect } from "react";

export const Tracker = ({ element }: { element: Element }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    observer["observe"](element);
  }, [element]);
  return null;
};
