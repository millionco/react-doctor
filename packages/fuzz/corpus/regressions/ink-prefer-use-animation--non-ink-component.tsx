// rule: ink-prefer-use-animation
// weakness: framework-gating
// source: adversarial audit of PR 1404 Ink component ownership
import { useEffect, useState } from "react";

export const Dashboard = () => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => value + 1), 80);
    return () => clearInterval(timer);
  }, []);
  return <div>{frame}</div>;
};
