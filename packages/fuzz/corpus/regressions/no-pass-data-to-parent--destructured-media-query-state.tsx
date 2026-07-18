// rule: no-pass-data-to-parent
// weakness: external-state-origin-through-object-pattern
// source: react-bench write-react-azouaoui-med-react-pro-sidebar hEYzUSm

import { useEffect, useRef } from "react";

interface SidebarProps {
  onBreakPoint?: (broken: boolean) => void;
}

export const Sidebar = ({ onBreakPoint }: SidebarProps) => {
  const { matches: broken, resolved } = useMediaQueryState("(max-width: 768px)");
  const lastReportedBrokenRef = useRef(false);

  useEffect(() => {
    if (resolved && broken !== lastReportedBrokenRef.current) {
      onBreakPoint?.(broken);
      lastReportedBrokenRef.current = broken;
    }
  }, [broken, resolved, onBreakPoint]);

  return null;
};
