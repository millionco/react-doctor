// rule: effect-needs-cleanup
// weakness: identity-provenance
// source: PR #1199 adversarial audit — a shared assignment-form iterator hid different collections
import { useEffect } from "react";

const setupEvents = ["mousedown", "focusin"] as const;
const cleanupEvents = ["keydown"] as const;

export const OutsideAction = ({ onOutsideAction }: { onOutsideAction: EventListener }) => {
  useEffect(() => {
    let event: string;
    for (event of setupEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    return () => {
      for (event of cleanupEvents) {
        document.removeEventListener(event, onOutsideAction);
      }
    };
  }, [onOutsideAction]);
  return null;
};
