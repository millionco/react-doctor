// rule: effect-needs-cleanup
// weakness: alias-guard
// source: adversarial review of the legacy MediaQueryList cleanup regression
import { useEffect } from "react";

declare const replacementListener: () => void;

export const Theme = ({ handle }: { handle: () => void }) => {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let listener = handle;
    media.addListener(listener);
    listener = replacementListener;
    return () => media.removeListener(listener);
  }, [handle]);
  return null;
};
