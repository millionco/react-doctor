// rule: no-ref-current-in-render
// weakness: provider-identity
// source: independent synthetic merged imported provider exposure
// verdict: pass
const rewriteProvider = () => {
  interface Group {}
  mutate(Group);
};
rewriteProvider();

import { useRef } from "react";
import { Group } from "three";
export const Badge = () => {
  const model = useRef(new Group());
  model.current.position.set(4, 5, 6);
  return <div />;
};
