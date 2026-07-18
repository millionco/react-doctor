// rule: r3f-no-clone-in-use-frame
// weakness: provenance
// source: Cursor Bugbot review of PR #1371
import { useFrame } from "@react-three/fiber";

const record = { current: { clone() {} } };

export const Scene = () => {
  useFrame(() => record.current.clone());
  return null;
};
