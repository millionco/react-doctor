// rule: r3f-no-null-loader-input
// source: Cursor Bugbot review on millionco/react-doctor#1371
import { useGLTF } from "@react-three/drei";

const missingModelUrl = null;
const selectedModelUrl = missingModelUrl;

export const MissingModel = () => {
  const model = useGLTF(selectedModelUrl ?? null);
  return <primitive object={model.scene} />;
};
