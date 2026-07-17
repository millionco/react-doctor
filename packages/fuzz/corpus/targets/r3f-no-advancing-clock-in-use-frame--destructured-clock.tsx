// rule: r3f-no-advancing-clock-in-use-frame
// source: React Three Fiber shared-clock callback contract
import { useFrame } from "@react-three/fiber";

export const ClockScene = () => {
  useFrame((state) => {
    const { clock } = state;
    clock.getDelta();
  });
  return null;
};
