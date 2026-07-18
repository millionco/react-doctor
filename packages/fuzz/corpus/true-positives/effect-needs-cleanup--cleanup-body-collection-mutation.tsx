// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1380 Bugbot follow-up — cleanup-body mutation dropped registered entries

import { useEffect } from "react";

export const Subscriptions = ({ emitter, subscriptions }) => {
  useEffect(() => {
    subscriptions.forEach(({ event, handler }) => {
      emitter.on(event, handler);
    });

    return () => {
      subscriptions.pop();
      subscriptions.forEach(({ event, handler }) => {
        emitter.off(event, handler);
      });
    };
  }, [emitter, subscriptions]);

  return null;
};
