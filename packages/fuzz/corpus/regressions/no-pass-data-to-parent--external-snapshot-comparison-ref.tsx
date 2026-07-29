// rule: no-pass-data-to-parent
// verdict: pass
// weakness: external-state-origin-through-comparison-ref
// source: react-bench write-react-azouaoui-med-react-pro-sidebar q35NJos

import { useEffect, useRef } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface SidebarProps {
  breakPoint: string;
  onBreakPoint?: (broken: boolean) => void;
}

export const Sidebar = ({ breakPoint, onBreakPoint }: SidebarProps) => {
  const broken = useMediaQuery(`(max-width: ${breakPoint})`);
  const previousBrokenRef = useRef(broken);
  const hasReportedRef = useRef(false);

  useEffect(() => {
    if (previousBrokenRef.current === broken) return;
    previousBrokenRef.current = broken;
    if (!hasReportedRef.current) {
      hasReportedRef.current = true;
      if (broken) onBreakPoint?.(true);
      return;
    }
    onBreakPoint?.(broken);
  }, [broken, onBreakPoint]);

  return null;
};
