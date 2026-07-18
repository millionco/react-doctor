// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1380 Bugbot follow-up — additive mutations preserve every registered entry

import { useEffect } from "react";

export const Subscriptions = ({ emitter, extraHandler, subscriptions }) => {
  useEffect(() => {
    subscriptions.forEach(({ event, handler }) => {
      emitter.on(event, handler);
    });

    return () => {
      subscriptions.push({ event: "extra", handler: extraHandler });
      subscriptions.forEach(({ event, handler }) => {
        emitter.off(event, handler);
      });
    };
  }, [emitter, extraHandler, subscriptions]);

  return null;
};
