// rule: effect-needs-cleanup
// verdict: pass
import { useEffect } from "react";
export const Canvas = () => {
  useEffect(() => {
    const handle = (event) => {
      if (!event.target) return;
      update(event);
    };
    const options = supportsPassive() ? { passive: false } : false;
    document.addEventListener("move", handle, options);
    return () => document.removeEventListener("move", handle, false);
  }, []);
  return null;
};
