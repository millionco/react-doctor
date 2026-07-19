// rule: r3f-no-mutate-loader-cache
// weakness: copy-tracking
// source: adversarial audit
import { useGLTF } from "@react-three/drei";

export const Scene = ({ url }: { url: string }) => {
  const model = useGLTF(url);
  const clone = model.scene.clone();
  clone.geometry.center();
  return <primitive object={clone} />;
};
