// rule: rerender-lazy-state-init
// weakness: named-react-hook-alias
// source: synthetic audit regression
import { createContext, useContext as readContext, useState } from "react";
const Primary = createContext("theme");
export const Panel = () => {
  const [value] = useState(readContext(Primary));
  return <span>{String(value)}</span>;
};
