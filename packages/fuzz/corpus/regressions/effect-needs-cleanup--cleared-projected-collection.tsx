// rule: effect-needs-cleanup
// weakness: control-flow
// expect: diagnostic
// source: PR #1380 adversarial review — clearing the replay collection loses registrations

import { useEffect } from "react";

export const Subscriptions = ({ emitter, subscriptions }) => {
  useEffect(() => {
    subscriptions.forEach(({ event, handler }) => {
      emitter.on(event, handler);
    });

    return () => {
      subscriptions.length = 0;
      subscriptions.forEach(({ event, handler }) => {
        emitter.off(event, handler);
      });
    };
  }, [emitter, subscriptions]);

  return null;
};
