// rule: prefer-use-sync-external-store
// verdict: pass
// weakness: binding-identity
// source: independent synthetic regression

import { useEffect, useState } from "react";

const otherHandler = () => {};

const readWindowSpan = () => window.innerWidth;

export const useWindowSpan = () => {
  const [span, setSpan] = useState(readWindowSpan());
  useEffect(() => {
    function refreshSpan() {
      setSpan(readWindowSpan());
    }
    window.addEventListener("resize", refreshSpan);
    return () => window.removeEventListener("resize", otherHandler);
  }, []);
  return span;
};
