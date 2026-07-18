// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1380 Bugbot follow-up — unrelated forEach wrappers hid non-exhaustive cleanup

import { useEffect } from "react";

export const Subscriptions = ({ emitter, subscriptions, unrelatedItems }) => {
  useEffect(() => {
    subscriptions.forEach(({ event, handler }) => {
      emitter.on(event, handler);
    });

    return () => {
      unrelatedItems.forEach(() => {
        subscriptions.forEach(({ event, handler }) => {
          emitter.off(event, handler);
        });
      });
    };
  }, [emitter, subscriptions, unrelatedItems]);

  return null;
};
