// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: independent synthetic
// verdict: fail
import { useEffect, useState } from "react";
interface CounterProps {
  pending: Promise<void>;
  readReady: () => boolean;
}
export const Counter = ({ pending, readReady }: CounterProps) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      await pending;
      active = true;
      if (active && readReady()) setCount(1);
    };
    void load();
    return () => {
      active = false;
    };
  }, [pending, readReady]);
  return <output>{count}</output>;
};
