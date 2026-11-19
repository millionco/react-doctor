// rule: no-ref-current-in-render
// weakness: library-idiom
// source: synthetic regression
// verdict: pass
import { useRef } from "react";

const KEY = Symbol();

export const useSubscriptionRegistry = (value: string) => {
  const input = useRef(value);
  const registry = useRef<{ [KEY]: unknown } | undefined>(undefined);
  if (!registry.current) {
    const listeners = new Set<(value: string) => void>();
    const notify = () => listeners.forEach((listener) => listener(input.current));
    registry.current = { [KEY]: { input, listeners, notify } };
  }
  return registry.current;
};
