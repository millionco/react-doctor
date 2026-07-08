// rule: react-hooks/set-state-in-effect
// weakness: control-flow
// source: facebook/react#34905 (setState after await in callback invoked from effect)
import { useCallback, useEffect, useState } from "react";

export const Component = () => {
  const [ready, setReady] = useState(false);
  const f = useCallback(async () => {
    await fetch("...");
    setReady(true);
  }, []);

  useEffect(() => {
    f();
  }, [f]);

  return <div>{ready ? "Ready" : "Loading"}</div>;
};
