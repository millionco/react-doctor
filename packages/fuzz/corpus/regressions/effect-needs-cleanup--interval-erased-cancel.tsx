// rule: effect-needs-cleanup
// weakness: name-heuristic
// source: synthetic
// verdict: pass
import { useEffect } from "react";
interface clearInterval {}
export const IntervalPanel = ({ consume }: { consume: () => void }) => {
  useEffect(() => {
    const interval = setInterval(() => {
      consume();
    }, 10);
    return () => clearInterval(interval);
  }, [consume]);
  return <div />;
};
