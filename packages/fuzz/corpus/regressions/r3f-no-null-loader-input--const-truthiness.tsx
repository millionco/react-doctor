// rule: r3f-no-null-loader-input
// weakness: constant-propagation
// source: Cursor Bugbot review on millionco/react-doctor#1371
import { useGLTF } from "@react-three/drei";

const enabled = true;
const modelUrl = "/model.glb";
const shouldLoad = enabled;

export const StableModel = () => {
  const model = useGLTF(shouldLoad ? modelUrl : null);
  return <primitive object={model.scene} />;
};
