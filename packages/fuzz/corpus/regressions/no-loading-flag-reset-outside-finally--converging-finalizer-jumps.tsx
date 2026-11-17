// rule: no-loading-flag-reset-outside-finally
// verdict: pass
// weakness: control-flow
// source: invented synthetic converging jump protocol
import { useRef, useState } from "react";

export const useRefresh = (request, skipPreparation) => {
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const ticket = ++sequence.current;
    setBusy(true);
    try {
      await request();
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
      preparation: {
        if (skipPreparation) break preparation;
      }
      for (let index = 0; index < 1; index++) {
        continue;
      }
      if (sequence.current === ticket) setBusy(false);
    }
  };
  return { busy, refresh, refreshAgain };
};
