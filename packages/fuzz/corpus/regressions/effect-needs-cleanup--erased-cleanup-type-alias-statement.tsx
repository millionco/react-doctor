// rule: effect-needs-cleanup
// weakness: erased-statement-admission
// source: independently synthetic native listener allocator
// verdict: pass
import { useEffect } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => {
        type CleanupLabel = string;
        document.removeEventListener("click", handler, false);
      };
    };
    return allocate();
  }, []);
  return null;
};
