// rule: effect-needs-cleanup
import { useEffect, useRef } from "react";

export const Tooltip = ({ delayShow }) => {
  const timerRef = useRef(null);
  const pendingOpenRef = useRef(null);
  const cancelPendingOpen = () => {
    if (!pendingOpenRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingOpenRef.current = null;
  };
  const commitPendingOpen = (pendingOpen) => {
    if (pendingOpenRef.current !== pendingOpen) return;
    pendingOpenRef.current = null;
    timerRef.current = null;
  };
  useEffect(() => () => cancelPendingOpen(), []);
  useEffect(() => {
    const pendingOpen = pendingOpenRef.current;
    if (pendingOpen?.kind !== "interaction") return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commitPendingOpen(pendingOpen), delayShow);
  }, [delayShow]);
  return null;
};
