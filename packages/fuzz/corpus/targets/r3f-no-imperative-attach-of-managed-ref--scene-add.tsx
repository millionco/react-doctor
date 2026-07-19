// rule: r3f-no-imperative-attach-of-managed-ref
import "@react-three/fiber";
import { useRef } from "react";

export const Scene = ({ scene }) => {
  const group = useRef(null);
  scene.add(group.current);
  return <group ref={group} />;
};
