// rule: prefer-use-sync-external-store
// verdict: fail
// weakness: function-declaration
// source: independent synthetic regression

import { useEffect, useState } from "react";

const readWindowSpan = () => window.innerWidth;

export const useWindowSpan = () => {
  const [span, setSpan] = useState(readWindowSpan());
  useEffect(() => {
    function refreshSpan() {
      setSpan(readWindowSpan());
    }
    window.addEventListener("resize", refreshSpan);
    return () => window.removeEventListener("resize", refreshSpan);
  }, []);
  return span;
};
