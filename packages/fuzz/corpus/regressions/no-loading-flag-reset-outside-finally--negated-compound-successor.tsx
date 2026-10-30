// rule: no-loading-flag-reset-outside-finally
// verdict: pass
// weakness: alias-guard
// source: invented synthetic committed request protocol
// The effect reset intentionally exercises committed ownership.
import { useEffect, useRef, useState } from "react";

export const useRefresh = (request) => {
  const sequence = useRef(0);
  const active = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    active.current = true;
    // eslint-disable-next-line react/set-state-in-effect
    setBusy(false);
    return () => {
      active.current = false;
    };
  }, []);
  const refresh = async () => {
    if (!active.current) return;
    const ticket = ++sequence.current;
    setBusy(true);
    try {
      await request();
    } finally {
      if (active.current && sequence.current === ticket) setBusy(false);
    }
  };
  const refreshAgain = async () => {
    if (!active.current) return;
    const ticket = ++sequence.current;
    setBusy(true);
    try {
      await request();
    } finally {
      const isStale = () => sequence.current !== ticket;
      if (!isStale() && active.current) setBusy(false);
    }
  };
  return { busy, refresh, refreshAgain };
};
