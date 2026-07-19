// rule: r3f-no-state-in-pointer-move
// weakness: library-idiom
// source: Daytona parity, pmndrs/react-three-fiber Viewcube
import "@react-three/fiber";
import { useState } from "react";

export const Viewcube = () => {
  const [hover, setHover] = useState(0);

  return (
    <mesh
      onPointerMove={(event) => setHover(Math.floor((event.faceIndex || 0) / 2))}
      userData={{ hover }}
    />
  );
};
