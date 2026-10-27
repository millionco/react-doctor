// rule: effect-needs-cleanup
// weakness: wrapper-transparency
// source: synthetic
// verdict: fail
import { useEffect } from "react";

const handleResize = () => {};
const registerResizeListener = () => {
  window.addEventListener("resize", handleResize);
};

export const ResizeListenerPanel = () => {
  useEffect(() => {
    registerResizeListener();
  }, []);
  return null;
};
