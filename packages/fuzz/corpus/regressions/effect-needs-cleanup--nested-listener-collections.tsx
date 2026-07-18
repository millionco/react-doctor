// rule: effect-needs-cleanup
// weakness: control-flow
// source: ASAP_FIX ReactTooltip fix-react-reacttooltip-react-too__GGzpuvK

import { useEffect } from "react";

interface TooltipProps {
  anchorRefs: ReadonlyArray<{ current: HTMLElement | null }>;
}

export const Tooltip = ({ anchorRefs }: TooltipProps) => {
  useEffect(() => {
    const elementRefs = new Set(anchorRefs);
    const enabledEvents = [];
    const handleFocus = () => {};
    enabledEvents.push({ event: "focus", listener: handleFocus, capture: true });

    enabledEvents.forEach(({ event, listener, capture }) => {
      elementRefs.forEach((elementRef) => {
        elementRef.current?.addEventListener(event, listener, capture);
      });
    });

    return () => {
      enabledEvents.forEach(({ event, listener, capture }) => {
        elementRefs.forEach((elementRef) => {
          elementRef.current?.removeEventListener(event, listener, capture);
        });
      });
    };
  }, [anchorRefs]);

  return null;
};
