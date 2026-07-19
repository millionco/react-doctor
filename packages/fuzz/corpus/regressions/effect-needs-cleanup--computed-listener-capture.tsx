// rule: effect-needs-cleanup
// weakness: control-flow
// source: ASAP_FIX ReactTooltip fix-react-reacttooltip-react-too__PdQZ9Sz

import { useEffect } from "react";

export const ComputedCaptureListeners = () => {
  useEffect(() => {
    const element = document.body;
    const listener = () => {};
    const enabledEvents = [
      { event: "focus", listener },
      { event: "blur", listener },
    ];

    enabledEvents.forEach(({ event, listener: eventListener }) => {
      element.addEventListener(event, eventListener, event === "focus" || event === "blur");
    });

    return () => {
      enabledEvents.forEach(({ event, listener: eventListener }) => {
        element.removeEventListener(event, eventListener, event === "focus" || event === "blur");
      });
    };
  }, []);

  return null;
};
