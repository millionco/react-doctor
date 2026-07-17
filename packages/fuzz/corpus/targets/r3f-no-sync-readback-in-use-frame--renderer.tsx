import { useFrame } from "@react-three/fiber";

export const Readback = () => {
  useFrame(({ gl }) => {
    gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixels);
  });
  return null;
};
