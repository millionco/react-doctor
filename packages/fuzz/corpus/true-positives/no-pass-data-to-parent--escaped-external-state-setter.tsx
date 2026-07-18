// rule: no-pass-data-to-parent
// weakness: other
// source: PR #1342 review

import { useEffect, useState } from "react";

interface SidebarProps {
  onBreakPoint: (broken: boolean) => void;
}

const useSidebarMediaState = () => {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 768px)");
    const update = (event: MediaQueryListEvent) => setBroken(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return [broken, setBroken] as const;
};

export const Sidebar = ({ onBreakPoint }: SidebarProps) => {
  const [broken, setBroken] = useSidebarMediaState();

  useEffect(() => {
    onBreakPoint(broken);
  }, [broken, onBreakPoint]);

  return <button onClick={() => setBroken(false)}>Reset</button>;
};
