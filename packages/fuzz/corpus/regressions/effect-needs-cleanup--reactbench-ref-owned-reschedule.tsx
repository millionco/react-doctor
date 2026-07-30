// verdict: pass
// rule: effect-needs-cleanup
// weakness: copy-tracking
// source: React Bench exact audit fix-react-reacttooltip-react-too__8qEHJro
import { useCallback, useEffect, useRef } from "react";

interface PendingOpen {
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

interface RefOwnedRescheduleProps {
  delay: number;
  open: () => void;
}

export const RefOwnedReschedule = ({ delay, open }: RefOwnedRescheduleProps) => {
  const pendingOpenRef = useRef<PendingOpen | null>(null);

  const clearTimerRef = (ownedRef: React.MutableRefObject<PendingOpen | null>) => {
    if (!ownedRef.current) return;
    clearTimeout(ownedRef.current.timer);
    ownedRef.current = null;
  };

  const cancelPendingOpen = useCallback(() => {
    clearTimerRef(pendingOpenRef);
  }, []);

  useEffect(() => {
    return () => cancelPendingOpen();
  }, [cancelPendingOpen]);

  useEffect(() => {
    cancelPendingOpen();
    const timer = setTimeout(open, delay);
    pendingOpenRef.current = {
      startedAt: Date.now(),
      timer,
    };
  }, [cancelPendingOpen, delay, open]);

  return null;
};
