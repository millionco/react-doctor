// rule: effect-raf-loop-needs-cancel
// weakness: identity-provenance
// source: PR #1000 deep adversarial audit
import { useEffect } from "react";

export const Ticker = () => {
  useEffect(() => {
    const state = { mounted: true, running: true };
    const loop = () => {
      if (!state.running) return;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => {
      state.mounted = false;
    };
  }, []);
  return null;
};
