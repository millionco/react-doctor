// rule: r3f-no-inline-resource-prop
// source: official R3F scaling-performance resource-reuse contract
import { Canvas } from "@react-three/fiber";
import { MeshBasicMaterial } from "three";

export const InlineMaterialScene = () => (
  <Canvas>
    <mesh material={new MeshBasicMaterial()} />
  </Canvas>
);
