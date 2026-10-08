// rule: effect-needs-cleanup
// weakness: control-flow
// source: github.com/millionco/react-doctor/issues/1856
// verdict: pass
import { useEffect } from "react";

export function RetryUntilTargetExists() {
  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    let frame = 0;
    const start = () => {
      frame = 0;
      const target = document.getElementById("first");
      if (!target) {
        frame = requestAnimationFrame(start);
        return;
      }
      observer = new IntersectionObserver(() => {});
      observer.observe(target);
    };
    start();
    return () => {
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
