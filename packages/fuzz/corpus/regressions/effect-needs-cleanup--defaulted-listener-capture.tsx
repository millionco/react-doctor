// rule: effect-needs-cleanup
// weakness: wrapper-transparency
// source: ASAP_FIX ReactTooltip fix-react-reacttooltip-react-too__iXxrTMb

import { useEffect } from "react";

interface DefaultedCaptureListener {
  event: string;
  listener: EventListener;
  capture?: boolean;
}

export const DefaultedCaptureListeners = () => {
  useEffect(() => {
    const element = document.body;
    const listener = () => {};
    const enabledEvents: DefaultedCaptureListener[] = [{ event: "focus", listener, capture: true }];

    enabledEvents.forEach(({ event, listener: eventListener, capture = false }) => {
      element.addEventListener(event, eventListener, capture);
    });

    return () => {
      enabledEvents.forEach(({ event, listener: eventListener, capture = false }) => {
        element.removeEventListener(event, eventListener, capture);
      });
    };
  }, []);

  return null;
};
