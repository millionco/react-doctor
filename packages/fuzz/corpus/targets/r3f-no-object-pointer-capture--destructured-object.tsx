// rule: r3f-no-object-pointer-capture
import { Canvas } from "@react-three/fiber";

export const Scene = () => (
  <Canvas>
    <mesh onPointerDown={({ object }) => object.setPointerCapture(1)} />
  </Canvas>
);
