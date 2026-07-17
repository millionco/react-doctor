// rule: r3f-no-inline-resource-prop
import type { RootState } from "@react-three/fiber";
import { MeshBasicMaterial } from "three";

interface SceneProps {
  state?: RootState;
}

export const Scene = (_properties: SceneProps) => <mesh material={new MeshBasicMaterial()} />;
