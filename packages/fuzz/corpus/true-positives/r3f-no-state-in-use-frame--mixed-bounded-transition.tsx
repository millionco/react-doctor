// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: ship review

import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const Scene = ({ elapsed }) => {
  const [active, setActive] = useState(false);
  useFrame(() => {
    if (elapsed > 3) setActive(readActive());
    else if (elapsed < 1) setActive(true);
    else setActive(false);
  });
  return active ? <mesh /> : null;
};
