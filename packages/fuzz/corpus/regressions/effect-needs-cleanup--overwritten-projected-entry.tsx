// rule: effect-needs-cleanup
// weakness: control-flow
// expect: diagnostic
// source: PR #1380 Bugbot follow-up — overwriting an entry loses its registration pair

import { useEffect } from "react";

export const Subscriptions = ({ emitter, subscriptions }) => {
  useEffect(() => {
    subscriptions.forEach(({ event, handler }) => {
      emitter.on(event, handler);
    });

    return () => {
      subscriptions[0] = subscriptions[1];
      subscriptions.forEach(({ event, handler }) => {
        emitter.off(event, handler);
      });
    };
  }, [emitter, subscriptions]);

  return null;
};
