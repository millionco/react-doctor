// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: PR #1559 ship review
// verdict: fail

import { useEffect } from "react";

export const HelperMutatedDisposerCollection = ({ sources }) => {
  useEffect(() => {
    const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const dropLast = () => unsubscribers.pop();
    dropLast();
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [sources]);

  return null;
};
