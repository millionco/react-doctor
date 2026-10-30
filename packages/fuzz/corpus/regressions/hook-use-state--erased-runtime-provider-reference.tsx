// rule: hook-use-state
// weakness: alias-guard
// source: independently-authored-public-synthetic
// verdict: fail
import { useState } from "react";
import { mutate } from "./external";
function expose() {
  interface useState {}
  mutate(useState);
}
expose();
export const Panel = () => {
  const [value] = useState(0);
  return <div>{value}</div>;
};
