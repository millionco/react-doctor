import { useEffect, type EffectCallback as ReactEffectCallback } from "react";

export const useForwardedEffect = (effect: ReactEffectCallback) => {
  useEffect(() => {
    effect();
  }, [effect]);
};
