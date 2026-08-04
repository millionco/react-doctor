// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1559 generated ownership matrix
// verdict: pass

import { useEffect } from "react";

export const OwnedReplay = ({ condition, sources }) => {
  useEffect(() => {
    let timer = null;
    const arm = () => {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {}, 30000);
    };
    arm();
    arm();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const unsubscribers = sources.map((source) => source.addListener("change", () => {}));
    const ownedUnsubscribers = unsubscribers.slice();
    return () => {
      for (const unsubscribe of ownedUnsubscribers) {
        unsubscribe();
        if (condition) continue;
      }
    };
  }, [condition, sources]);

  return null;
};
