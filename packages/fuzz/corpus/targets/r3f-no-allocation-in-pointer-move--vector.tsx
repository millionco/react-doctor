import "@react-three/fiber";
import { Vector3 } from "three";

export const PointerVector = () => (
  <mesh onPointerMove={(event) => new Vector3().copy(event.point)} />
);
