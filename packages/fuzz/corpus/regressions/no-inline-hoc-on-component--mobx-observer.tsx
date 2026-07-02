// rule: no-inline-hoc-on-component
// weakness: library-idiom
// source: PR #1000 adversarial review (canonical mobx-react-lite form)
import { observer } from "mobx-react-lite";
import { useState, useEffect } from "react";

export const Timer = observer(() => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((prev) => prev + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <div>{tick}</div>;
});
