// rule: effect-needs-cleanup
// weakness: cleanup-target-provenance
// source: PR #1346 Bugbot review — collection unobserve target mismatch

import { useEffect } from "react";

export const ObserverGroup = ({ target, otherTarget }: { target: Node; otherTarget: Node }) => {
  useEffect(() => {
    const observers: MutationObserver[] = [];
    const observer = new MutationObserver(() => update());
    observer.observe(target, { attributes: true });
    observers.push(observer);
    return () => observers.forEach((retainedObserver) => retainedObserver.unobserve(otherTarget));
  }, [target, otherTarget]);
  return null;
};
