// rule: no-pass-data-to-parent
// weakness: library-idiom
// source: PR #1342 review

import { useEffect, useSyncExternalStore } from "react";

interface SidebarProps {
  onBreakPoint: (broken: boolean) => void;
}

const useMediaQuery = (query: string) =>
  useSyncExternalStore(
    (notify) => {
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", notify);
      return () => mediaQuery.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );

export const Sidebar = ({ onBreakPoint }: SidebarProps) => {
  const broken = useMediaQuery("(max-width: 768px)");

  useEffect(() => {
    onBreakPoint(broken);
  }, [broken, onBreakPoint]);

  return null;
};
