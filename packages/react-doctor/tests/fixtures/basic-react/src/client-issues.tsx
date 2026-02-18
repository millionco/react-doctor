import { useEffect, useRef } from "react";

const ScrollListenerComponent = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handler = () => {};
    element.addEventListener("scroll", handler, { passive: true });
    return () => element.removeEventListener("scroll", handler);
  }, []);

  return <div ref={ref} />;
};

export { ScrollListenerComponent };
