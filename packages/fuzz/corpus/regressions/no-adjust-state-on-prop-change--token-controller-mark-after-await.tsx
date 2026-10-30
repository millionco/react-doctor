// rule: no-adjust-state-on-prop-change
// verdict: fail
// weakness: control-flow
// source: synthetic separate token and controller map bookkeeping
import { useEffect, useRef, useState } from "react";
interface PanelProps {
  category: string;
}
const requestResource = async (signal: AbortSignal): Promise<string> =>
  signal.aborted ? "stopped" : "ready";
export const ResourcePanel = ({ category }: PanelProps) => {
  const tokens = useRef<Map<string, number>>(new Map());
  const controllers = useRef<Map<string, AbortController>>(new Map());
  const counter = useRef(0);
  const [busy, setBusy] = useState<Record<string, number>>({});
  const markBusy = (resourceKey: string, token: number) => {
    tokens.current.set(resourceKey, token);
    setBusy((previous) => ({ ...previous, [resourceKey]: token }));
  };
  const clearBusy = (resourceKey: string) => {
    tokens.current.delete(resourceKey);
    controllers.current.delete(resourceKey);
    setBusy((previous) => {
      if (!(resourceKey in previous)) return previous;
      const next = { ...previous };
      delete next[resourceKey];
      return next;
    });
  };
  const cancel = (resourceKey: string) => {
    if (!tokens.current.has(resourceKey)) return;
    controllers.current.get(resourceKey)?.abort();
    clearBusy(resourceKey);
  };
  const isStale = (resourceKey: string, token: number) => tokens.current.get(resourceKey) !== token;
  const stopAll = () => {
    tokens.current.clear();
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    setBusy({});
  };
  useEffect(() => {
    stopAll();
  }, [category]);
  useEffect(
    () => () => {
      tokens.current.clear();
      controllers.current.forEach((controller) => controller.abort());
      controllers.current.clear();
    },
    [],
  );
  const start = async (resourceKey: string) => {
    if (tokens.current.has(resourceKey)) return;
    const token = ++counter.current;
    const controller = new AbortController();
    controllers.current.set(resourceKey, controller);
    await requestResource(controller.signal);
    markBusy(resourceKey, token);
    try {
      await requestResource(controller.signal);
      if (isStale(resourceKey, token)) return;
      clearBusy(resourceKey);
    } catch {
      if (isStale(resourceKey, token)) return;
      clearBusy(resourceKey);
    }
  };
  return (
    <button
      onClick={() => {
        if (busy.entry !== undefined) cancel("entry");
        else void start("entry");
      }}
    >
      {busy.entry !== undefined ? "Cancel" : "Start"}
    </button>
  );
};
