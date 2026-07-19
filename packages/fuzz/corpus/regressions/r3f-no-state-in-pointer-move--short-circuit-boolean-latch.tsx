// rule: r3f-no-state-in-pointer-move
// weakness: control-flow
// source: Cursor Bugbot review on PR #1371
import "@react-three/fiber";
import { useState } from "react";

export const Scene = () => {
  const [started, setStarted] = useState(false);

  return <mesh visible={started} onPointerMove={() => !started && setStarted(true)} />;
};
