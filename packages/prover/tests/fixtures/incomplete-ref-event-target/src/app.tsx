import { useEffect, useRef } from "react";

const handleClick = () => undefined;

export const RefListener = () => {
  const elementRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.addEventListener("click", handleClick);
    return () => element.removeEventListener("click", handleClick);
  }, []);

  return <div ref={elementRef} />;
};
