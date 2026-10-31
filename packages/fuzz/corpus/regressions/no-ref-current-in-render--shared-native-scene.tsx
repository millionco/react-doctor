// rule: no-ref-current-in-render
// weakness: alias-guard
// source: independent synthetic native scene result transport
// verdict: pass

import { useRef } from "react";
import { Group } from "three";
import { useThree } from "@react-three/fiber";
import { consume } from "./opaque-consumer";
export const Badge = () => {
  const model = useRef(new Group());
  consume(useThree());
  model.current.position.set(1, 2, 3);
  return <div />;
};
