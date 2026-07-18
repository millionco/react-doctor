// rule: r3f-no-sync-readback-in-use-frame
// weakness: control-flow
// source: adversarial review of millionco/react-doctor#1371
import { useFrame } from "@react-three/fiber";

export const Capture = () => {
  useFrame(({ gl }) => {
    const capture = () => gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixels);
    if (captureRequested.current) capture();
  });
  return null;
};
