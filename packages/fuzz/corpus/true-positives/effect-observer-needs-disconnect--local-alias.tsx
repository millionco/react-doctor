import { useEffect } from "react";

export const Preview = ({ element }: { element: Element }) => {
  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    const localObserver = observer;
    localObserver.observe(element);
  }, [element]);
  return null;
};
