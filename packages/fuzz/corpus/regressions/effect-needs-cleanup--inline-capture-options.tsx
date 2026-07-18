// rule: effect-needs-cleanup
// weakness: identity-provenance
// source: PR #1380 Bugbot review — matching inline option bags hid the capture identity

import { useEffect } from "react";

export const OutsideAction = ({ capture, onOutsideAction }) => {
  useEffect(() => {
    document.addEventListener("focusin", onOutsideAction, { capture, passive: true });
    return () => {
      document.removeEventListener("focusin", onOutsideAction, { capture, passive: false });
    };
  }, [capture, onOutsideAction]);

  return null;
};
