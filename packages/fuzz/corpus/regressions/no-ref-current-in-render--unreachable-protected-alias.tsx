// rule: no-ref-current-in-render
// weakness: control-flow
// verdict: pass
import { useRef } from "react";

export const Widget = ({ value }: { value: string }) => {
  const container = useRef<Record<string, string>>({}).current;
  Object.defineProperty(container, "entry", { writable: true });
  if (0n) container.entry = value;
  return null;
};
