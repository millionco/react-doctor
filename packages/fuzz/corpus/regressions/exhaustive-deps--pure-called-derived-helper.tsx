// rule: exhaustive-deps
// weakness: derived-local-equivalence
// source: react-bench Sidebar qhkPS3B — helper output is wholly derived from breakPoint
import { useMemo } from "react";

const BREAK_POINTS = { md: "768px" };

export const Sidebar = ({ breakPoint }: { breakPoint?: string }) => {
  const getBreakpointValue = () => {
    if (!breakPoint) return undefined;
    if (breakPoint === "all") return "screen";
    if (breakPoint in BREAK_POINTS) return `(max-width: ${BREAK_POINTS.md})`;
    return `(max-width: ${breakPoint})`;
  };
  return useMemo(() => getBreakpointValue(), [breakPoint]);
};
