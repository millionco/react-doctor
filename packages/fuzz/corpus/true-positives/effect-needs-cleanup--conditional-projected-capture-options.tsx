// rule: effect-needs-cleanup
// weakness: control-flow
// source: PR #1380 Bugbot follow-up — option bags hid projected capture cleanup safety

import { useEffect } from "react";

export const OutsideActions = ({ shouldCleanup, subscriptions }) => {
  useEffect(() => {
    subscriptions.forEach(({ event, handler, capture }) => {
      document.addEventListener(event, handler, { capture });
    });

    return () => {
      subscriptions.forEach(({ event, handler, capture }) => {
        if (shouldCleanup) {
          document.removeEventListener(event, handler, { capture });
        }
      });
    };
  }, [shouldCleanup, subscriptions]);

  return null;
};
