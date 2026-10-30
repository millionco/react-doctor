// rule: effect-needs-cleanup
// weakness: erased-runtime-binding
// source: independently synthetic returned native listener allocator
// verdict: pass
interface document {}
import { useEffect } from "react";
export const Example = () => {
  useEffect(() => {
    const nativeTarget = document;
    const handler = () => {};
    const allocate = () => {
      nativeTarget.addEventListener("click", handler, false);
      return () => nativeTarget.removeEventListener("click", handler, false);
    };
    return allocate();
  }, []);
  return null;
};
