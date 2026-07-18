// rule: r3f-no-inline-resource-prop
import "@react-three/fiber";
import { MeshBasicMaterial } from "three";

const material = new MeshBasicMaterial();

export const Scene = () => <mesh material={material.clone()} />;
