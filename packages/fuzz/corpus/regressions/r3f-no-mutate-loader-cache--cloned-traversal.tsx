// rule: r3f-no-mutate-loader-cache
import { useGLTF } from "@react-three/drei";

export const Scene = ({ root, url }) => {
  const model = useGLTF(url).scene.clone(true);
  model.traverse((child) => {
    child.position.set(0, 1, 0);
  });
  root.add(model);
  return null;
};
