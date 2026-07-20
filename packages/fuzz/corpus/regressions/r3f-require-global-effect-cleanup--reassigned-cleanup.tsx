// rule: r3f-require-global-effect-cleanup
// weakness: wrapper-transparency
// source: RDE pmndrs/react-xr@8d2fda1a packages/react/xr/src/layer.tsx
import { addEffect } from "@react-three/fiber";
import { useEffect } from "react";

export const useForwardEvents = (update) => {
  useEffect(() => {
    let cleanup;
    const register = () => {
      cleanup?.();
      const cleanupUpdate = addEffect(update);
      cleanup = () => cleanupUpdate();
    };
    register();
    return () => cleanup?.();
  }, [update]);
};
