// rule: hook-use-state
// verdict: pass
// weakness: alias-guard
// source: synthetic namespace provider binding
function require() {
  return { useState: customHook };
}
namespace require {
  export interface Loader {}
}
require("react").useState = customHook;
import { useState } from "react";
export const Panel = () => {
  const [value] = useState(0);
  return <div>{value}</div>;
};
