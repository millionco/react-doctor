// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: immutable aliases retain a genuine reducer dispatch in a deferred callback
// verdict: fail
import { useEffect, useReducer } from "react";

const assign = <T,>(callback: (value: T) => void, value: T) => callback(value);

interface CounterProps {
  id: string;
}

export const Counter = ({ id }: CounterProps) => {
  const [count, dispatch] = useReducer((state: number, next: number) => state + next, 0);
  const first = dispatch;
  const writer = first;
  useEffect(() => {
    queueMicrotask(() => assign(writer, id.length));
  }, [id]);
  return <div>{count}</div>;
};
