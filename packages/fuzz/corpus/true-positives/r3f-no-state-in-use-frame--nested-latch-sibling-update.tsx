// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: Cursor Bugbot review of PR #1371
import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const Scene = ({ done }) => {
  const [started, setStarted] = useState(true);
  const [count, setCount] = useState(0);
  useFrame(() => {
    if (started) {
      setCount((value) => value + 1);
      if (done) setStarted(false);
    }
  });
  return count;
};
