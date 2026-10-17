// rule: hook-use-state
// verdict: fail
// weakness: alias-guard
// source: synthetic namespace provider binding
namespace require {
  export namespace Shape {
    export interface Loader {}
  }
}
require("react").useState = customHook;
import { useState } from "react";
export const Panel = () => {
  const [value] = useState(0);
  return <div>{value}</div>;
};
