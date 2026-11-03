// rule: no-set-state-after-await-in-effect
// weakness: alias-guard
// source: a callback copied after replacing a reducer dispatch is not a React writer
// verdict: pass
import { useEffect, useReducer } from "react";

const assign = <T,>(callback: (value: T) => void, value: T) => callback(value);

interface CounterProps {
  id: string;
}

export const Counter = ({ id }: CounterProps) => {
  let [count, dispatch] = useReducer((state: number, next: number) => state + next, 0);
  dispatch = () => {};
  const writer = dispatch;
  useEffect(() => {
    queueMicrotask(() => assign(writer, id.length));
  }, [id]);
  return <div>{count}</div>;
};
