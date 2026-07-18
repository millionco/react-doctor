// rule: r3f-no-null-loader-input
// weakness: constant-propagation
// source: Cursor Bugbot review on millionco/react-doctor#1371
import { useGLTF } from "@react-three/drei";

const enabled = true;
const disabled = false;
const modelUrl = "/model.glb";
const shouldLoad = enabled;

export const StableModel = ({ isPreview }) => {
  const model = useGLTF(shouldLoad ? modelUrl : null);
  useGLTF((enabled && modelUrl) || null);
  useGLTF(disabled || modelUrl || null);
  useGLTF((!disabled && modelUrl) || null);
  useGLTF((isPreview ? modelUrl : "/fallback.glb") || null);
  useGLTF(isPreview || modelUrl || null);
  return <primitive object={model.scene} />;
};
