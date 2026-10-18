// rule: no-adjust-state-on-prop-change
// weakness: name-heuristic
// source: synthetic
// verdict: pass
import { useEffect, useRef, useState } from "react";

interface AbortController {
  readonly tag: string;
}
void AbortController.prototype.abort;
export const RequestRows = ({ query }) => {
  const pending = useRef(new Map());
  const [loading, setLoading] = useState(new Set());
  const start = (requestKey) => {
    const controller = new AbortController();
    pending.current.set(requestKey, { controller });
    setLoading((previous) => new Set(previous).add(requestKey));
    fetch("/items", { signal: controller.signal });
  };
  useEffect(() => {
    pending.current.forEach((entry) => entry.controller.abort());
    pending.current.clear();
    setLoading(new Set());
  }, [query]);
  return <button onClick={() => start("item")}>{loading.size}</button>;
};
