// rule: no-ref-current-in-render
// weakness: provider-identity
// source: independent synthetic erased namespace regression
// verdict: pass
namespace require {
  export interface Marker {}
}
require("three").Group = class {};

import { useRef } from "react";
import { Group } from "three";
export const Badge = () => {
  const model = useRef(new Group());
  model.current.position.set(4, 5, 6);
  return <div />;
};
