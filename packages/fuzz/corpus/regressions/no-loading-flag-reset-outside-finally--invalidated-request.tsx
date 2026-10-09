// rule: no-loading-flag-reset-outside-finally
// verdict: fail
import { useState, useRef, useEffect, useCallback } from "react";
export const View = ({ open, viewId }) => {
  const [, setLoading] = useState(open);
  const request = useRef(0);
  const run = useCallback(async () => {
    const token = ++request.current;
    setLoading(true);
    try {
      await load(viewId);
    } finally {
      if (token === request.current) setLoading(false);
    }
  }, [viewId]);
  useEffect(() => {
    if (open) run();
  }, [open, run]);
  useEffect(() => {
    request.current++;
    setLoading(open);
  }, [open, viewId]);
};
