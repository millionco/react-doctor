import { EffectComposer } from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";

export const Experience = () => {
  useFrame(() => updatePhysics(), 1);
  return null;
};

export const Effects = () => <EffectComposer />;
