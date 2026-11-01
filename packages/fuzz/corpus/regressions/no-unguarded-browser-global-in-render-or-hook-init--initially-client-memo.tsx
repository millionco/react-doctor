// rule: no-unguarded-browser-global-in-render-or-hook-init
// verdict: fail
// weakness: control-flow
// source: synthetic native React memo mount-gate regression
import { useEffect, useMemo, useState } from "react";

export const BrowserTitlePanel = () => {
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    setMounted(true);
  }, []);
  const title = useMemo(() => {
    if (!mounted) return null;
    return document.title;
  }, [mounted]);
  return <output>{title}</output>;
};
