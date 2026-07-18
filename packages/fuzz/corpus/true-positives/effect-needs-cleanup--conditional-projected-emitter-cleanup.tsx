// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1380 Bugbot review — projected emitter cleanup was not checked for exhaustiveness

import { useEffect } from "react";

export const Subscriptions = ({ emitter, shouldCleanup, subscriptions }) => {
  useEffect(() => {
    subscriptions.forEach(({ event, handler }) => {
      emitter.on(event, handler);
    });

    return () => {
      subscriptions.forEach(({ event, handler }) => {
        if (shouldCleanup) emitter.off(event, handler);
      });
    };
  }, [emitter, shouldCleanup, subscriptions]);

  return null;
};
