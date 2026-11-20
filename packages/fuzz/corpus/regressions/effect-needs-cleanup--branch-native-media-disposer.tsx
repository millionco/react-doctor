// rule: effect-needs-cleanup
// verdict: pass

import { useEffect } from "react";

export function Contrast({ query, update }: { query: string; update: (active: boolean) => void }) {
  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => update(media.matches);
    let dispose: (() => void) | undefined;
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", listener);
      dispose = () => media.removeEventListener("change", listener);
    } else if (typeof media.addListener === "function") {
      media.addListener(listener);
      dispose = () => media.removeListener(listener);
    }
    return dispose;
  }, [query, update]);
  return null;
}
