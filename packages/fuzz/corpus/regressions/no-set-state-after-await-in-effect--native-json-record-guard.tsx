// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: synthetic regression
// verdict: pass
import { useEffect, useState } from "react";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const Result = ({ endpoint }: { endpoint: string }) => {
  const [result, setResult] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch(endpoint);
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      if (!cancelled && isRecord(data) && isRecord(data.result)) {
        setResult(data.result);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);
  return <output>{String(result)}</output>;
};
