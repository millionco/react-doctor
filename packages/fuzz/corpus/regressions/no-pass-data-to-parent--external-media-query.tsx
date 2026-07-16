// rule: no-pass-data-to-parent
// weakness: external-state-origin
// source: ISSUES_TO_FIX_ASAP.md React Pro Sidebar report
import { useEffect, useRef } from "react";

export const SidebarStatus = ({ onBreakPoint }: { onBreakPoint: (broken: boolean) => void }) => {
  const onBreakPointRef = useRef(onBreakPoint);
  onBreakPointRef.current = onBreakPoint;
  const broken = useMediaQuery("(max-width: 768px)");
  const reportedBrokenRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (reportedBrokenRef.current === broken) return;
    const isInitialReport = reportedBrokenRef.current === null;
    reportedBrokenRef.current = broken;
    if (isInitialReport && !broken) return;
    onBreakPointRef.current?.(broken);
  }, [broken]);

  return null;
};
