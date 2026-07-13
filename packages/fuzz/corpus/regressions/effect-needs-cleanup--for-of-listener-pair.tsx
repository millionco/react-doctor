// rule: effect-needs-cleanup
// weakness: control-flow
// source: wojtekmaj/react-daterange-picker@4c3074e9 — matched listener loops
import { useEffect } from "react";

const outsideActionEvents = ["mousedown", "focusin", "touchstart"] as const;

export const OutsideAction = ({
  isOpen,
  onOutsideAction,
}: {
  isOpen: boolean;
  onOutsideAction: EventListener;
}) => {
  useEffect(() => {
    if (!isOpen) return undefined;
    for (const event of outsideActionEvents) {
      document.addEventListener(event, onOutsideAction);
    }
    return () => {
      for (const event of outsideActionEvents) {
        document.removeEventListener(event, onOutsideAction);
      }
    };
  }, [isOpen, onOutsideAction]);
  return null;
};
