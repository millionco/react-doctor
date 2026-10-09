// rule: effect-needs-cleanup
// verdict: pass
import { useEffect } from "react";
export const Panel = () => {
  useEffect(() => {
    const handler = () => {};
    const entries = [{ event: "resize", handler, capture: true }];
    entries.forEach(({ event, handler, capture = false }) => {
      window.addEventListener(event, handler, capture);
    });
    const releaseAll = () => {
      entries.forEach(({ event, handler, capture = false }) => {
        window.removeEventListener(event, handler, capture);
      });
    };
    return () => {
      releaseAll();
    };
  }, []);
  return null;
};
