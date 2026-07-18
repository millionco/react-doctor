// rule: no-pass-data-to-parent
// weakness: other
// source: PR #1342 review

import { useEffect, useState } from "react";

interface SidebarProps {
  onChildValue: (value: string) => void;
}

const useSidebarMediaState = () => {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 768px)");
    const update = (event: MediaQueryListEvent) => setBroken(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const childValue = readChildValue();
  return { broken, childValue };
};

export const Sidebar = ({ onChildValue }: SidebarProps) => {
  const { childValue } = useSidebarMediaState();

  useEffect(() => {
    onChildValue(childValue);
  }, [childValue, onChildValue]);

  return null;
};
