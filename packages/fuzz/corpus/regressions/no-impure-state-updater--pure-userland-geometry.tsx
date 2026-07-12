// rule: no-impure-state-updater
// weakness: name-heuristic
// source: react-bench recent-rule audit
import { useState } from "react";

const geometry = {
  getBoundingClientRect: () => ({ width: 10 }),
};

export const useWidth = () => {
  const [width, setWidth] = useState(0);
  const updateWidth = () => setWidth(() => geometry.getBoundingClientRect().width);
  return { updateWidth, width };
};
