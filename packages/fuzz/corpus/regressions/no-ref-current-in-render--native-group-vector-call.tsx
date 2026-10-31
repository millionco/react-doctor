// rule: no-ref-current-in-render
// weakness: library-idiom
// source: independent synthetic native Group mutation regression
// verdict: fail

import { useRef } from "react";
import { Group } from "three";
export const Badge = () => {
  const model = useRef(new Group());
  model.current.position.set(4, 5, 6);
  return <div />;
};
