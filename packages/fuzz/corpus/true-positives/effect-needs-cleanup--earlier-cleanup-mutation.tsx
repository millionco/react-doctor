// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1380 Bugbot follow-up — source order hid cleanup-body collection mutation

import { useEffect } from "react";

export const Subscriptions = ({ emitter, subscriptions }) => {
  useEffect(() => {
    function releaseSubscriptions() {
      subscriptions.pop();
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
