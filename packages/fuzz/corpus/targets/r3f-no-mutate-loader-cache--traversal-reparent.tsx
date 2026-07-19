// rule: r3f-no-mutate-loader-cache
import { useGLTF } from "@react-three/drei";

export const Scene = ({ root, url }) => {
  const model = useGLTF(url);
  model.scene.traverse((child) => {
    child.castShadow = true;
    child.material.color.set("hotpink");
  });
  root.attach(model.scene);
  return null;
};
