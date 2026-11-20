// rule: no-adjust-state-on-prop-change
// weakness: browser-storage-initialization
// source: authored browser storage completion control
// verdict: pass

import { useEffect, useState } from "react";

const isPreview = () => {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("demo");
};
const readStored = (name: string) => {
  if (typeof window === "undefined" || isPreview()) return false;
  return localStorage.getItem(name) === "ready";
};
const storeReady = (name: string) => {
  if (typeof window !== "undefined" && !isPreview()) localStorage.setItem(name, "ready");
};
export function Preview({
  name,
  immediate,
  fallback,
}: {
  name: string;
  immediate: boolean;
  fallback: string;
}) {
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    if (typeof window !== "undefined") {
      const existing = immediate || readStored(name);
      if (existing) {
        if (immediate) storeReady(name);
        setValue(fallback);
      }
      setReady(true);
    }
  }, [name, immediate, fallback, ready]);
  useEffect(() => {
    if (!ready) return;
    document.title = value;
  }, [ready, value]);
  return <span>{value}</span>;
}
