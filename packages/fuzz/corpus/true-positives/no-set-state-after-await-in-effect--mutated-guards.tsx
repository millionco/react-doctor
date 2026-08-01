// rule: no-set-state-after-await-in-effect
// weakness: mutated-guard
import { useEffect, useRef, useState } from "react";

export const HelperReset = ({ id }: { id: string }) => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    const resetCancellation = () => {
      cancelled = false;
    };
    const run = async () => {
      const value = await load(id);
      resetCancellation();
      if (cancelled) return;
      setValue(value);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);
  return null;
};

export const SequenceReset = ({ id }: { id: string }) => {
  const [, setValue] = useState<string>();
  const requestIdRef = useRef(0);
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const run = async () => {
      const value = await load(id);
      requestIdRef.current = requestId;
      if (requestId !== requestIdRef.current) return;
      setValue(value);
    };
    void run();
  }, [id]);
  return null;
};

export const ConditionalAbort = ({ id, shouldAbort }: { id: string; shouldAbort: boolean }) => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      const value = await load(id, { signal: controller.signal });
      setValue(value);
    };
    void run();
    return () => {
      if (shouldAbort) controller.abort();
    };
  }, [id, shouldAbort]);
  return null;
};
