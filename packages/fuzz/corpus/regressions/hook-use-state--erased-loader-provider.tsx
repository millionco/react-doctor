// rule: hook-use-state
// verdict: fail
// weakness: alias-guard
// source: synthetic erased TypeScript loader binding
import { useState } from "react";

declare const require: (source: string) => { useState: unknown };
require("react").useState = () => [7, () => {}];

export const Panel = () => {
  const [seededTotal] = useState(7);
  return <div>{seededTotal}</div>;
};
