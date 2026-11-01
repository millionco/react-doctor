// rule: no-ref-current-in-render
// weakness: provider-identity
// source: independent synthetic runtime binding regression
// verdict: pass
import type require = require("provider-types");
require("three").Group = class {};

import { useRef } from "react";
import { Group } from "three";
export const Badge = () => {
  const model = useRef(new Group());
  model.current.position.set(4, 5, 6);
  return <div />;
};
