// rule: r3f-no-inline-resource-prop
import "@react-three/fiber";
import { BufferGeometry, MeshBasicMaterial } from "three";

export const Scene = () => {
  const geometry = new BufferGeometry();
  const material = new MeshBasicMaterial();
  return (
    <mesh
      geometry={geometry.getAttribute("position").clone()}
      material={material.toJSON().clone()}
    />
  );
};
