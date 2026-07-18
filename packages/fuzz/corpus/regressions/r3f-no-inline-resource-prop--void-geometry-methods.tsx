// rule: r3f-no-inline-resource-prop
import "@react-three/fiber";
import { BufferGeometry } from "three";

export const Scene = () => (
  <>
    <mesh geometry={new BufferGeometry().computeBoundingBox()} />
    <mesh geometry={new BufferGeometry().addGroup(0, 3)} />
  </>
);
