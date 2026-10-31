// rule: no-ref-current-in-render
// weakness: control-flow
// source: independent synthetic deferred native Group mutation boundary
// verdict: pass

import { useEffect, useRef } from "react";
import { Group } from "three";
export const Badge = () => {
  const model = useRef(new Group());
  useEffect(() => {
    model.current.scale.set(2, 2, 2);
  }, []);
  return <div />;
};
