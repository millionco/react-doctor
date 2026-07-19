import "@react-three/fiber";
import { useState } from "react";

export const PointerPreview = () => {
  const [, setPoint] = useState(null);
  return <mesh onPointerMove={(event) => setPoint(event.point)} />;
};
