// rule: no-adjust-state-on-prop-change
// verdict: fail
// weakness: copy-tracking
// source: synthetic unmatched controller-record bookkeeping
import { useCallback, useEffect, useRef, useState } from "react";
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
  const clearBusy = (resourceKey: string, attempt: number) => {
    const active = requests.current.get(resourceKey);
    if (!active || active.attempt !== attempt) return;
    requests.current.delete(resourceKey);
    setBusy((previous) => {
      if (!previous.has(resourceKey)) return previous;
      const next = new Set(previous);
      next.delete(resourceKey);
      return next;
    });
  };
  const cancel = (resourceKey: string) => {
    const active = requests.current.get(resourceKey);
    if (!active) return;
    const { controller, attempt } = active;
    controller.abort();
    clearBusy(resourceKey, attempt);
  };
  const start = async (resourceKey: string) => {
    if (requests.current.has(resourceKey)) return;
    const controller = new AbortController();
    const attempt = ++counter.current;
    requests.current.set(resourceKey, { controller, attempt });
    setBusy((previous) => new Set(previous).add(resourceKey));
    setBusy((previous) => new Set(previous).add("unrelated-view-state"));
    try {
      await requestResource(controller.signal);
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } catch {
      if (requests.current.get(resourceKey)?.attempt !== attempt) return;
    } finally {
      clearBusy(resourceKey, attempt);
    }
  };
  return (
    <button
      onClick={() => {
        if (busy.has("entry")) cancel("entry");
        else void start("entry");
      }}
    >
      {busy.has("entry") ? "Cancel" : "Start"}
    </button>
  );
};
