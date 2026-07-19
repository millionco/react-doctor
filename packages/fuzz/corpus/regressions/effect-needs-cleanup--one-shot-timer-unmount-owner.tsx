// rule: effect-needs-cleanup
// weakness: control-flow
// source: ASAP_FIX ReactTooltip fix-react-reacttooltip-react-too__mMYsnZp

import { useEffect, useRef } from "react";

interface PendingOpen {
  delay: number;
}

interface PendingOpenTimerProps {
  delay: number;
}

export const PendingOpenTimer = ({ delay }: PendingOpenTimerProps) => {
  const pendingOpenRef = useRef<PendingOpen | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const pendingOpen = pendingOpenRef.current;
    if (!pendingOpen) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => {
        timerRef.current = null;
        pendingOpenRef.current = null;
      },
      Math.max(delay, pendingOpen.delay),
    );
  }, [delay]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return null;
};
