// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: Cursor Bugbot review

import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const Scene = ({ enabled, elapsed }) => {
  const [active, setActive] = useState(false);
  useFrame(() => {
    if (enabled) {
      if (elapsed > 3) setActive(false);
      else if (elapsed < 1) setActive(true);
    }
  });
  return active ? <mesh /> : null;
};
