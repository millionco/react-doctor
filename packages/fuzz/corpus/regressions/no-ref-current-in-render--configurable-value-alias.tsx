// rule: no-ref-current-in-render
// weakness: alias-guard
// verdict: pass
import { useRef } from "react";

export const Widget = ({ value, notify }: { value: string; notify: (value: object) => void }) => {
  const container = useRef<Record<string, string>>({}).current;
  Object.defineProperty(container, "entry", { writable: true, configurable: true });
  notify(container);
  container.entry = value;
  return null;
};
