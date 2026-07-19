// rule: r3f-no-inline-resource-prop
import "@react-three/fiber";
import { BufferGeometry } from "three";

const geometry = new BufferGeometry();

export const Scene = () => <mesh geometry={geometry.toNonIndexed()} />;
