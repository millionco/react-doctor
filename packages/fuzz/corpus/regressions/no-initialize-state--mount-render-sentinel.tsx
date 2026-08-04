// rule: no-initialize-state
// verdict: fail
// weakness: mount-only-render-sentinel
// source: ReactBench semantic false negative
import { useEffect, useState } from "react";

export const ClientOnlyContent = () => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  return isMounted ? <main>Ready</main> : null;
};
