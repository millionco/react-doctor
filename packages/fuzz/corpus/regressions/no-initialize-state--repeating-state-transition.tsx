// rule: no-initialize-state
// weakness: same-effect state lifecycle
// source: Alice39s/kuma-mieru@545dca6 components/alerts/SystemStatus.tsx
import { useEffect, useState } from "react";

export const RepeatingStatus = () => {
  const [isAnimating, setIsAnimating] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => {
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), 1000);
    }, 1000);
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 1000);
    return () => clearInterval(interval);
  }, []);
  return <output className={isAnimating ? "pulse" : undefined} />;
};
