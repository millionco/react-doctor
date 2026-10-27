// rule: no-use-before-define
// weakness: eager-dependency
// source: synthetic
// verdict: fail
import { useCallback } from "react";

export const Panel = () => {
  const selected = useCallback(() => complete(), [complete]);
  const complete = () => {};
  return <button onClick={selected}>Run</button>;
};
