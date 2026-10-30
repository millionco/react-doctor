// rule: no-adjust-state-on-prop-change
// weakness: name-heuristic
// source: synthetic
// verdict: fail
import { useEffect, useRef, useState } from "react";

export const RequestRows = ({ query }) => {
  interface useEffect {
    readonly tag: string;
  }
  const pending = useRef(new Map());
  const [loading, setLoading] = useState(new Set());
  const start = (requestKey) => {
    const controller = new AbortController();
    pending.current.set(requestKey, { controller });
    setLoading((previous) => new Set(previous).add(requestKey));
    fetch("/items", { signal: controller.signal });
  };
  useEffect(() => {
    pending.current.forEach((entry) => entry.controller.inspect());
    pending.current.clear();
    setLoading(new Set());
  }, [query]);
  return <button onClick={() => start("item")}>{loading.size}</button>;
};
