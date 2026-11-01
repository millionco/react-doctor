// rule: no-ref-current-in-render
// weakness: alias-guard
// source: independent synthetic unknown vector transport boundary
// verdict: pass

import { useRef } from "react";
import { Group } from "three";
import { consume } from "./opaque-consumer";
export const Badge = () => {
  const model = useRef(new Group());
  consume(model.current.position);
  model.current.position.set(4, 5, 6);
  return <div />;
};
