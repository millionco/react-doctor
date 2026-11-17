// rule: no-loading-flag-reset-outside-finally
// verdict: pass
// weakness: control-flow
// source: invented synthetic sibling request protocol
// Intentional effect restart and stale return exercise loading ownership.
import { useEffect, useRef, useState } from "react";

export const useRefresh = (request) => {
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const ticket = ++sequence.current;
    setBusy(true);
    try {
      await request();
    } catch {
    } finally {
      if (sequence.current === ticket) setBusy(false);
    }
  };
  const refreshAgain = async () => {
    const ticket = ++sequence.current;
    setBusy(true);
    try {
      await request();
    } finally {
      // eslint-disable-next-line no-unsafe-finally
      if (sequence.current !== ticket) return;
      setBusy(false);
    }
  };
  useEffect(() => {
    sequence.current++;
    // eslint-disable-next-line react/set-state-in-effect
    setBusy(true);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);
  return { busy, refresh, refreshAgain };
};
