// rule: r3f-require-projection-matrix-update
import { useFrame } from "@react-three/fiber";

export const CameraRig = ({ aspect }: { aspect: number }) => {
  useFrame(({ camera }) => {
    camera.aspect = aspect;
  });
  return null;
};
