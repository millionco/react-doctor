// rule: no-adjust-state-on-prop-change
// verdict: pass
// file-path: src/components/controller-record.tsx
// weakness: alias-guard
// source: synthetic controller-record review
import { useCallback, useEffect, useRef, useState } from "react";
interface Map<Key, Value> extends globalThis.Map<Key, Value> {}
interface PanelProps {
  category: string;
}
interface RequestEntry {
  controller: AbortController;
  attempt: number;
}
const requestResource = async (signal: AbortSignal): Promise<string> =>
  signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const requests = useRef<Map<string, RequestEntry>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const stopAll = useCallback(() => {
    if (requests.current.size === 0) return;
    requests.current.forEach(({ controller }) => controller.abort());
    requests.current.clear();
    setBusy(new Set());
  }, []);
  useEffect(() => {
    stopAll();
  }, [category, stopAll]);
  useEffect(() => stopAll, [stopAll]);
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy((previous) => new Set(previous).add(resourceKey));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      const active = requests.current.get(resourceKey);
      if (active?.attempt === attempt) {
        requests.current.delete(resourceKey);
        setBusy((previous) => {
          const next = new Set(previous);
          next.delete(resourceKey);
          return next;
        });
      }
    }
  };
  return (
    <button
      onClick={() => {
        void start("entry");
      }}
    >
      {busy.has("entry") ? "Working" : "Start"}
    </button>
  );
};
