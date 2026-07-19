// rule: r3f-no-dispose-loader-cache
import { useGLTF } from "@react-three/drei";

export const Scene = ({ url }) => {
  const model = useGLTF(url);
  model.scene.traverseVisible((child) => {
    child.geometry.dispose();
    child.material.dispose();
  });
  return null;
};
