// rule: no-adjust-state-on-prop-change
// verdict: safe
import { useCallback, useEffect, useRef, useState } from "react";
export const Downloads = ({ query }) => {
  const pending = useRef(new Map());
  const [loading, setLoading] = useState(new Set());
  const cancel = useCallback(() => {
    if (pending.current.size === 0) return;
    pending.current.forEach((request) => request.controller.abort());
    pending.current.clear();
    setLoading(new Set());
  }, []);
  useEffect(() => {
    cancel();
  }, [query]);
  const start = (id) => {
    const request = { controller: new AbortController() };
    pending.current.set(id, request);
    setLoading((previous) => new Set(previous).add(id));
  };
  return <button onClick={() => start("row")}>{loading.size}</button>;
};
