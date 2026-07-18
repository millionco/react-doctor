// rule: effect-needs-cleanup
// weakness: identity-provenance
// source: PR #1380 Bugbot follow-up — opaque options collided with an inline capture value

import { useEffect } from "react";

export const OutsideAction = ({ listenerOptions, onOutsideAction }) => {
  useEffect(() => {
    document.addEventListener("focusin", onOutsideAction, listenerOptions);
    return () => {
      document.removeEventListener("focusin", onOutsideAction, {
        capture: listenerOptions,
      });
    };
  }, [listenerOptions, onOutsideAction]);

  return null;
};
