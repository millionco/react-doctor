// rule: r3f-no-sync-readback-in-use-frame
// weakness: control-flow
// source: Cursor Bugbot review on millionco/react-doctor#1371
import { useFrame } from "@react-three/fiber";

export const GuardedReadback = ({ shouldCapture }: { shouldCapture: boolean }) => {
  useFrame(({ gl }) => {
    if (shouldCapture) {
      [target].forEach((currentTarget) => {
        gl.readRenderTargetPixels(currentTarget, 0, 0, 1, 1, pixels);
      });
    }
  });
  return null;
};
