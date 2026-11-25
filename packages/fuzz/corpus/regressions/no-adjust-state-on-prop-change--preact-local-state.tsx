import { useEffect, useState } from "preact/hooks";
export function Sample({ available }) {
  const [enabled, setEnabled] = useState(available);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (enabled) setReady(true);
  }, [enabled]);
  return <button onClick={() => setEnabled(!enabled)}>{String(ready)}</button>;
}
