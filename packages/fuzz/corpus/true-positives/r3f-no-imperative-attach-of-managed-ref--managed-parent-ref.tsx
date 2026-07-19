// rule: r3f-no-imperative-attach-of-managed-ref
// weakness: receiver-provenance
// source: second adversarial audit of the R3F rule candidate suite
import { useRef } from "react";
import "@react-three/fiber";

export const ReparentedMesh = () => {
  const parentRef = useRef(null);
  const childRef = useRef(null);
  parentRef.current.add(childRef.current);
  return (
    <group ref={parentRef}>
      <mesh ref={childRef} />
    </group>
  );
};
