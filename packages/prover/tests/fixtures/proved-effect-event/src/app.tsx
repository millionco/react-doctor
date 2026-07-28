import { useEffect, useEffectEvent, useState } from "react";

const normalizePosition = (position: number) => Math.max(0, position);

export const PointerTracker = () => {
  const [canMove, setCanMove] = useState(true);
  const [position, setPosition] = useState(0);
  const onMove = useEffectEvent((event: PointerEvent) => {
    if (canMove) setPosition(normalizePosition(event.clientX));
  });

  useEffect(() => {
    const installPointerListener = () => window.addEventListener("pointermove", onMove);
    installPointerListener();
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <button type="button" onClick={() => setCanMove(!canMove)}>
      {canMove ? "moving" : "paused"} at {position}
    </button>
  );
};
