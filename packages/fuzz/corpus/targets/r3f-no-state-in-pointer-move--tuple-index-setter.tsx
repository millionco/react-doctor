import "@react-three/fiber";
import { useState } from "react";

export const Scene = () => {
  const pointState = useState(null);
  return <mesh onPointerMove={(event) => pointState[1](event.point)} />;
};
