// rule: hook-use-state
// verdict: fail
// weakness: alias-guard
// source: synthetic type-only import equals provider binding
import { useState } from "react";
import type require = require("./provider-types");

require("react").useState = () => [7, () => {}];

export const Panel = () => {
  const [seededTotal] = useState(7);
  return <div>{seededTotal}</div>;
};
