// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: PR #1380 Bugbot follow-up — whole-receiver cleanup releases projected registrations

import { useEffect } from "react";

export const Subscriptions = ({ emitter, handlers }) => {
  useEffect(() => {
    handlers.forEach((handler) => {
      emitter.on("update", handler);
    });

    return () => emitter.off("update");
  }, [emitter, handlers]);

  return null;
};
