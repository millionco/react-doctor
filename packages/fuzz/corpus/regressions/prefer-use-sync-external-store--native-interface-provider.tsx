// rule: prefer-use-sync-external-store
// verdict: pass
// weakness: provider-mutation
// source: independent synthetic regression

EventTarget.prototype.addEventListener = () => {};
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
