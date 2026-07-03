// rule: no-initialize-state
// weakness: callback-argument call graph
// source: adversarial edge-case hunt (setter fired only from an observer callback in a mount effect)
import { useEffect, useState } from "react";

export const ObserverConnected = () => {
  const [entryCount, setEntryCount] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver((mutations) => setEntryCount(mutations.length));
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);
  return <output>{entryCount}</output>;
};
