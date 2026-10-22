// rule: no-unguarded-browser-global-in-render-or-hook-init
// verdict: fail
// weakness: control-flow
// source: synthetic cancelled memo callback return regression
import { useState, useEffect, useMemo } from "react";
const BrowserPanel = () => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return useMemo(() => {
    if (!mounted) {
      do {
        try {
          return null;
        } finally {
          break;
        }
      } while (false);
    }
    return document.title;
  }, [mounted]);
};
