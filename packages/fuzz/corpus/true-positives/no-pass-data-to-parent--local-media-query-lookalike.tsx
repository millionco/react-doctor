// rule: no-pass-data-to-parent
// weakness: misleading-hook-name
// source: adversarial control for React Pro Sidebar external-hook provenance
import { useEffect } from "react";

const useMediaQuery = () => readUserPreference();

export const LocalSidebarStatus = ({
  onBreakPoint,
}: {
  onBreakPoint: (broken: boolean) => void;
}) => {
  const broken = useMediaQuery();

  useEffect(() => {
    onBreakPoint(broken);
  }, [broken, onBreakPoint]);

  return null;
};
