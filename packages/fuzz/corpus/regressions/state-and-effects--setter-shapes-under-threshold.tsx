// rule: no-cascading-set-state
// weakness: control-flow
// source: FP-FIX history (handler-registered and cleanup-only setters don't cascade)
import { useEffect, useState } from "react";

export const Banner = ({ enabled }: { enabled: boolean }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  useEffect(() => {
    if (enabled) setIsVisible(true);
    const handleDismiss = () => setIsDismissed(true);
    window.addEventListener("dismiss-banner", handleDismiss);
    return () => window.removeEventListener("dismiss-banner", handleDismiss);
  }, [enabled]);
  return (
    <div>
      {String(isVisible)}
      {String(isDismissed)}
    </div>
  );
};

export const Reset = ({ id }: { id: string }) => {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  useEffect(() => {
    return () => {
      setA(0);
      setB(0);
    };
  }, [id]);
  return (
    <div>
      {a}
      {b}
    </div>
  );
};
