import { useFrame } from "@react-three/fiber";

export const CameraRig = () => {
  useFrame(() => (camera.position.x += 0.1));
  return null;
};
