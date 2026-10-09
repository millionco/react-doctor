// rule: effect-listener-cleanup-reference-mismatch
// verdict: unsafe
// file-path: corpus/regressions/effect-listener-cleanup-reference-mismatch--imported.tsx
import { useEffect } from "react";
import { attach, detach } from "./listener-identity-wrapper";
export const View = () => {
  useEffect(() => {
    attach("pulse", () => update());
    return () => detach("pulse", () => update());
  }, []);
  return null;
};
