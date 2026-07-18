// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: RDE VinayMatta63/threejs-portfolio@0599c682
import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const Game = () => {
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);

  useFrame(() => {
    if (started && didFail()) {
      setStarted(false);
      setFailed(true);
    }
  });

  return failed ? null : null;
};
