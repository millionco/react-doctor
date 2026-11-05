// rule: no-boolean-toggle-without-functional-update
// weakness: library-idiom
// source: synthetic
import { useLayoutEffect, useState } from "react";

export const Signal = () => {
  const [active, setActive] = useState(false);
  useLayoutEffect(() => {
    const timer = setTimeout(() => setActive(!active), 100);
    return () => clearInterval(timer);
  }, [active]);
  return active ? "on" : "off";
};
