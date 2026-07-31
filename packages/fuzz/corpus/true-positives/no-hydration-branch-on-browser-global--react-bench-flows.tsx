// rule: no-hydration-branch-on-browser-global
// weakness: dataflow
// source: ReactBench hydration audit

import { useMemo } from "react";

export const Background = ({ candidate }: { candidate: boolean }) => {
  const playable = useMemo(() => {
    let result = false;
    if (candidate && typeof document !== "undefined") {
      try {
        result = document.createElement("video").canPlayType("video/mp4") !== "";
      } catch {
        result = false;
      }
    }
    return { playable: result };
  }, [candidate]).playable;
  return playable ? <video /> : <img alt="" />;
};
