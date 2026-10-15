// rule: no-adjust-state-on-prop-change
// verdict: pass
// weakness: copy-tracking
// source: synthetic owned request cancellation
import { useEffect, useRef, useState } from "react";
export const Downloads = ({ query }) => {
  const requests = useRef({});
  const [loading, setLoading] = useState({});
  useEffect(() => {
    Object.values(requests.current).forEach((controller) => {
      controller.abort();
    });
    requests.current = {};
    setLoading({});
  }, [query]);
  const start = (entryId) => {
    const controller = new AbortController();
    requests.current[entryId] = controller;
    setLoading((previous) => ({ ...previous, [entryId]: true }));
  };
  return <button onClick={() => start("file")}>{Object.keys(loading).length}</button>;
};
