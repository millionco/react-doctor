// rule: effect-needs-cleanup
// weakness: control-flow
// source: GitHub issue #2347
// verdict: fail
import { useEffect } from "react";

export const DelayedBanner = () => {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      await fetch("/banner");

      timer = setTimeout(() => console.log("ready"), 1000);
    };
    void load();
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return null;
};
