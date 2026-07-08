import { useEffect, useRef } from "react";

const TouchMoveListenerComponent = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handler = () => {};
    element.addEventListener("touchmove", handler);
    return () => element.removeEventListener("touchmove", handler);
  }, []);

  return <div ref={ref} />;
};

export { TouchMoveListenerComponent };
