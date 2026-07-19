// rule: r3f-require-frame-delta
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";

export const Scene = ({ targetColor }) => {
  const color = useRef(null);
  useFrame(() => color.current.lerp(targetColor, 0.1));
  return <color ref={color} />;
};
