// rule: no-fetch-in-effect
// verdict: pass
import { useEffect, useState } from "react";

interface Snapshot {
  label: string;
}

const isCollection = (entry: unknown) =>
  Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);

export const RefreshStatus = () => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    let ignore = false;
    const refresh = async () => {
      try {
        const response = await fetch("/refresh/status");
        const envelope = await response.json().catch(() => ({}));
        if (!response.ok) return;
        if (!ignore && isCollection(envelope) && isCollection(envelope.result)) {
          setSnapshot(envelope.result as Snapshot);
        }
      } catch {}
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 100);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, []);
  return <output>{snapshot?.label}</output>;
};
