// rule: no-ref-current-in-render
// weakness: browser-guarded-detached-div
// source: synthetic audit regression
import { useRef } from "react";

export function Panel() {
  const host = useRef<HTMLDivElement | null>(null);
  if (host.current === null && typeof document !== "undefined") {
    host.current = document.createElement("div");
  }
  return <section />;
}
