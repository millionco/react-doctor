// rule: effect-needs-cleanup
// weakness: async-lifecycle-cleanup-control-flow
// source: PR #1559 generated ownership matrix
// verdict: fail

import { useEffect } from "react";

export const DeferredHelperAfterCleanup = () => {
  useEffect(() => {
    let timer = null;
    const arm = () => {
      if (timer != null) return;
      timer = setTimeout(() => {}, 30000);
    };
    Promise.resolve().then(arm);
    return () => clearTimeout(timer);
  }, []);

  return null;
};
