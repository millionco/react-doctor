// rule: hook-use-state
// verdict: pass
// weakness: alias-guard
// source: synthetic local provider binding merged with an interface
import { useState } from "react";

const require = () => ({ useState: () => [7, () => {}] });
interface require {}
require("react").useState = () => [9, () => {}];

export const Panel = () => {
  const [seededTotal] = useState(7);
  return <div>{seededTotal}</div>;
};
