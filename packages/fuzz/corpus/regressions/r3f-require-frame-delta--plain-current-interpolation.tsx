// rule: r3f-require-frame-delta
// weakness: provenance
// source: Cursor Bugbot review of PR #1371
import { useFrame } from "@react-three/fiber";

const value = { current: { lerp() {} } };

export const Scene = () => {
  useFrame(() => value.current.lerp(target, 0.1));
  return null;
};
