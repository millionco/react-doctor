// rule: r3f-no-state-in-pointer-move
// weakness: library-idiom
// source: RDE RodrigoHamuy/react-three-map batched-buildings.tsx
import "@react-three/fiber";
import { useState } from "react";

export const BatchedBuildings = () => {
  const [hoveredBatch, setHoveredBatch] = useState<number>();

  return (
    <batchedMesh
      onPointerMove={(event) => {
        event.stopPropagation();
        setHoveredBatch(event.batchId);
      }}
      userData={{ hoveredBatch }}
    />
  );
};
