// rule: no-adjust-state-on-prop-change
// weakness: control-flow
// source: synthetic nested timer cleanup
// verdict: pass
import { useEffect, useRef, useState } from "react";

export const Timer = ({ disabled }) => {
  const [active, setActive] = useState(true);
  const timer = useRef();
  useEffect(() => {
    if (active) {
      if (disabled) {
        clearTimeout(timer.current);
        setActive(false);
      }
    }
  }, [active, disabled]);
  return <span>{String(active)}</span>;
};
