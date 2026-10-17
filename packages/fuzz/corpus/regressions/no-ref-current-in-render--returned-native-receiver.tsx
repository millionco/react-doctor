// rule: no-ref-current-in-render
// weakness: alias-guard
// source: independent synthetic returned native receiver transport
// verdict: pass

import { useRef } from "react";
import { Group } from "three";
import { consume } from "./opaque-consumer";
export const Badge = () => {
  const model = useRef(new Group());
  consume(model.current.scale.set(4, 5, 6));
  model.current.position.set(1, 2, 3);
  return <div />;
};
