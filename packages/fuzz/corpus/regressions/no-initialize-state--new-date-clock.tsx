// rule: no-initialize-state
// weakness: library-idiom
// source: adversarial edge-case hunt (SSR-safe live clock seeded on mount)
import { useEffect, useState } from "react";

export const Clock = () => {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    setNow(new Date().toLocaleTimeString());
    const interval = window.setInterval(() => setNow(new Date().toLocaleTimeString()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  return <time>{now}</time>;
};
