// rule: r3f-no-clone-in-use-frame
// weakness: duplicate-report
// source: Cursor Bugbot review of PR #1371
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

export const Scene = ({ enabled }) => {
  const mesh = useRef(null);
  const clonePosition = () => mesh.current.position.clone();
  useFrame(() => {
    if (enabled) clonePosition();
    clonePosition();
  });
  return <mesh ref={mesh} />;
};
