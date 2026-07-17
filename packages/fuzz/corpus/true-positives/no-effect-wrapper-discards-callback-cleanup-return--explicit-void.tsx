// rule: no-effect-wrapper-discards-callback-cleanup-return
// weakness: control-flow
// source: PR #1365 deep audit

import { useEffect } from "react";

export const useForward = (effect: React.EffectCallback) => {
  useEffect(() => {
    void effect();
  }, [effect]);
};
