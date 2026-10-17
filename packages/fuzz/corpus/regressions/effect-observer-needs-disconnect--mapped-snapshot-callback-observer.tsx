// rule: effect-observer-needs-disconnect
// weakness: copy-tracking
// source: synthetic second callback observer alias regression
// verdict: fail

import { useEffect } from "react";
export const CallbackObserverPanel = () => {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll(".item"));
    const observers = targets.map((target) => {
      const observer = new IntersectionObserver(
        (entries, sameObserver) => {
          sameObserver.observe(otherTarget);
        },
        { threshold: 0.2 },
      );
      observer.observe(target);
      return observer;
    });
    return () => {
      targets.map((target, index) => observers[index]?.unobserve(target));
    };
  }, []);
  return null;
};

declare const otherTarget: Element;
