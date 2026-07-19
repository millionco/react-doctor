// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: Cursor Bugbot review on PR #1371
import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const Scene = () => {
  const [started, setStarted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(true);
  const [ready, setReady] = useState(true);

  useFrame(() => {
    void (!started && setStarted(true));
    void (loaded || setLoaded(true));
    void (active && setActive(false));
    void (!ready || setReady(false));
  });

  return null;
};
