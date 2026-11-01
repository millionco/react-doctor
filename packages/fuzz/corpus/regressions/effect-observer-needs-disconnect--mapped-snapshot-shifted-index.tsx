// rule: effect-observer-needs-disconnect
// weakness: copy-tracking
// source: synthetic mapped snapshot cleanup regression
// verdict: fail

import { useEffect } from "react";
export const MappedObserverPanel = () => {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll(".item"));
    const observers = targets.map((target) => {
      const observer = new IntersectionObserver(() => {}, { threshold: 0.2 });
      observer.observe(target);
      return observer;
    });
    return () => {
      targets.map((target, index) => observers[index + 1]?.unobserve(target));
    };
  }, []);
  return null;
};
