// rule: no-adjust-state-on-prop-change
// verdict: safe
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
export const Layer = ({ selector, children }) => {
  const target = useRef(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    target.current = document.querySelector(selector);
    setMounted(true);
  }, [selector]);
  return mounted && target.current ? createPortal(children, target.current) : null;
};
