// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: PR #1559 generated ownership matrix
// verdict: fail

import { useEffect } from "react";

export const EscapedDisposerCollection = ({ register, sources }) => {
  useEffect(() => {
    const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    register(unsubscribers);
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [register, sources]);

  return null;
};
