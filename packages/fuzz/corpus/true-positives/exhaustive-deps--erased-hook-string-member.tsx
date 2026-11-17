// rule: exhaustive-deps
// verdict: fail
// weakness: name-heuristic
// source: synthetic
import { useCallback } from "react";

export const Example = ({ value }: { value: string }) => {
  interface useCallback {}
  const actions = { ADD: value };
  const callback = useCallback(() => actions.ADD, []);
  return <button onClick={callback}>Run</button>;
};
