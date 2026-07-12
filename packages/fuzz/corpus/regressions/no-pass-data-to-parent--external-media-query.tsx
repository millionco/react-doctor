// rule: no-pass-data-to-parent
// weakness: external-state-origin
// source: ISSUES_TO_FIX_ASAP.md React Pro Sidebar report
import { useEffect } from "react";

export const SidebarStatus = ({ onBreakPoint }: { onBreakPoint: (broken: boolean) => void }) => {
  const broken = useMediaQuery("(max-width: 768px)");

  useEffect(() => {
    onBreakPoint(broken);
  }, [broken, onBreakPoint]);

  return null;
};
