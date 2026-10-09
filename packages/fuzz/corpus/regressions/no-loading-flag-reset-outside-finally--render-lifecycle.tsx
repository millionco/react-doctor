// rule: no-loading-flag-reset-outside-finally
// verdict: safe
import { useState, useRef, useEffect, useCallback } from "react";
export const View = ({ viewId, open }) => {
  const [, setLoading] = useState(open);
  const [identity, setIdentity] = useState({ viewId, open });
  const request = useRef(0);
  const currentView = useRef(viewId);
  const openRef = useRef(open);
  if (identity.viewId !== viewId || identity.open !== open) {
    setIdentity({ viewId, open });
    setLoading(open);
    request.current++;
  }
  currentView.current = viewId;
  openRef.current = open;
  const run = useCallback(async () => {
    const token = ++request.current;
    const savedView = viewId;
    setLoading(true);
    try {
      await load();
    } finally {
      if (token === request.current && currentView.current === savedView && openRef.current) {
        setLoading(false);
      }
    }
  }, [viewId]);
  useEffect(() => {
    if (!open) return;
    run();
  }, [open, run]);
};
