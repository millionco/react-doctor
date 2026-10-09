// rule: no-adjust-state-on-prop-change
// verdict: pass
import { useState, useEffect } from "react";
export const Panel = ({ notify }) => {
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready && !shown) {
      notify(null);
      setShown(true);
    }
  }, [ready, shown, notify]);
  return null;
};
