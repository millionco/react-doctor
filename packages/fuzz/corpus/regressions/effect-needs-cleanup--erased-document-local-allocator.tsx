// rule: effect-needs-cleanup
// weakness: erased-runtime-binding
// source: independently synthetic returned native listener allocator
// verdict: pass
interface document {}
import { useEffect } from "react";
export const Example = () => {
  useEffect(() => {
    const handler = () => {};
    const allocate = () => {
      document.addEventListener("click", handler, false);
      return () => document.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
