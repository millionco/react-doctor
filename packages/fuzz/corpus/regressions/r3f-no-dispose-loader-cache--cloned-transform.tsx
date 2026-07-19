// rule: r3f-no-dispose-loader-cache
import { useGLTF } from "@react-three/drei";

export const Scene = ({ url }) => {
  const model = useGLTF(url).scene.clone(true);
  model.traverse((child) => child.position.set(0, 1, 0));
  return null;
};
