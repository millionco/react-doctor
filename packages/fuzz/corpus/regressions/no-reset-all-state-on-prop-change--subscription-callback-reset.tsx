// rule: no-reset-all-state-on-prop-change
// weakness: setter-inside-subscription-callback
// source: RDE fizz run (excalidraw ToolPopover — emitter subscription reset)
import { useEffect, useState } from "react";

export const ToolPopover = ({
  app,
}: {
  app: { onPointerDownEmitter: { on: (fn: () => void) => (() => void) | undefined } };
}) => {
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  useEffect(() => {
    const unsubscribe = app.onPointerDownEmitter.on(() => {
      setIsPopupOpen(false);
    });
    return () => unsubscribe?.();
  }, [app]);
  return <div>{String(isPopupOpen)}</div>;
};
