// rule: effect-needs-cleanup
// weakness: control-flow
// source: github.com/millionco/react-doctor/issues/1856
// verdict: pass
import { useEffect } from "react";

const targets = [["first"], ["second"]] as const;

export function ObserveTupleLoop() {
  useEffect(() => {
    const observer = new IntersectionObserver(() => {});
    for (const [id] of targets) {
      const target = document.getElementById(id);
      if (!target) continue;
      observer.observe(target);
    }
    return () => observer.disconnect();
  }, []);
  return null;
}
