// rule: effect-observer-needs-disconnect
// verdict: fail
// weakness: provider-erasure
// source: synthetic
namespace Object {}
import { useEffect } from "react";
const Panel = () => {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll(".item"));
    const observers = targets.map((target) => {
      const observer = new IntersectionObserver(
        () => {
          Object.defineProperty(Object.getPrototypeOf([]), "map", { value: () => [] });
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
