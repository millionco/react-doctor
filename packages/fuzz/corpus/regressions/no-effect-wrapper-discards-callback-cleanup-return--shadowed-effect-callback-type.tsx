// rule: no-effect-wrapper-discards-callback-cleanup-return
// weakness: scope-shadowing
// source: PR #1365 deep audit
import { useEffect } from "react";

interface EffectCallback {
  (): number;
}

export const useValue = (effect: EffectCallback) => {
  useEffect(() => {
    effect();
  }, [effect]);
};
