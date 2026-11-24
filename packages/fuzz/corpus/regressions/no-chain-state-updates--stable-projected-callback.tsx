import { useEffect, useState } from "react";

const stableAction = () => {};
const project = ({ count, callback }) => ({ count, action: callback });
export function Panel() {
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);
  const { action } = project({ count, callback: stableAction });
  useEffect(() => {
    action();
    setReady(true);
  }, [action]);
  return <button onClick={() => setCount(count + 1)}>{String(ready)}</button>;
}
