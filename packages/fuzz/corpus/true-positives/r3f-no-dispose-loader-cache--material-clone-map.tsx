// rule: r3f-no-dispose-loader-cache
// weakness: copy-tracking
// source: adversarial audit
import { useGLTF } from "@react-three/drei";

export const Scene = ({ url }: { url: string }) => {
  const { materials } = useGLTF(url);
  const material = materials.Body.clone();
  material.map.dispose();
  return null;
};
