// rule: r3f-no-new-in-use-frame
import { useFrame } from "@react-three/fiber";

export const Scene = ({ scheduler }) => {
  useFrame(() => {
    scheduler.map(() => new Event("deferred"));
  });
  return null;
};
