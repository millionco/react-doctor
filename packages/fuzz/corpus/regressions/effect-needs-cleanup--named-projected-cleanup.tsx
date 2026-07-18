// rule: effect-needs-cleanup
// weakness: cleanup-provenance
// source: PR #1380 Bugbot follow-up — named cleanup exhaustively replays registrations

import { useEffect } from "react";

export const Subscriptions = ({ emitter, subscriptions }) => {
  useEffect(() => {
    function releaseSubscriptions() {
      subscriptions.forEach(({ event, handler }) => {
        emitter.off(event, handler);
      });
    }

    subscriptions.forEach(({ event, handler }) => {
      emitter.on(event, handler);
    });

    return releaseSubscriptions;
  }, [emitter, subscriptions]);

  return null;
};
