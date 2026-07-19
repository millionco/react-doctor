import "@react-three/fiber";
import { useState } from "react";
import { flushSync } from "react-dom";

export const Scene = () => {
  const [, setPoint] = useState(null);
  return <mesh onPointerMove={(event) => flushSync(() => setPoint(event.point))} />;
};
