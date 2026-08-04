import { useReducer } from "react";

declare const wrapReducer: <State, Action>(
  reducer: (state: State, action: Action) => State,
) => (state: State, action: Action) => State;

const increment = wrapReducer((count: number, _action: void) => count + 1);

export const Counter = () => {
  const [count, dispatch] = useReducer(increment, 0);
  return <button onClick={() => dispatch()}>{count}</button>;
};
