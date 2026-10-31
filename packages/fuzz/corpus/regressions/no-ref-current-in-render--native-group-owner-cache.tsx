// rule: no-ref-current-in-render
// weakness: control-flow
// source: independent synthetic captured-ref owner cache regression
// verdict: fail

import { useRef } from "react";
import { Group } from "three";
export const Badge = () => {
  const model = useRef(new Group());
  const Inner = () => {
    model.current.position.set(1, 2, 3);
    return null;
  };
  void Inner;
  model.current.scale.set(2, 2, 2);
  return <div />;
};
