// rule: effect-needs-cleanup
// weakness: control-flow
// source: GitHub issue #2347
// verdict: pass
import { useEffect } from "react";

export const DelayedBanner = () => {
  useEffect(() => {
    let isCancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      await fetch("/banner");
      if (isCancelled) return;
      timer = setTimeout(() => console.log("ready"), 1000);
    };
    void load();
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, []);
  return null;
};
