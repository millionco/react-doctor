// rule: no-set-state-after-await-in-effect
// weakness: conditional-invocation-path
import { useEffect, useState } from "react";

interface ConditionalLoaderProps {
  enabled: boolean;
  id: string;
}

export const DirectConditionalLoader = ({ enabled, id }: ConditionalLoaderProps) => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const value = await load(id);
      if (cancelled) return;
      setValue(value);
    };
    if (enabled) void run();
    if (!enabled) return;
    return () => {
      cancelled = true;
    };
  }, [enabled, id]);
  return null;
};

export const NestedConditionalLoader = ({ enabled, id }: ConditionalLoaderProps) => {
  const [, setValue] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const value = await load(id);
      if (cancelled) return;
      setValue(value);
    };
    const innerStart = () => run();
    const start = () => {
      if (enabled) innerStart();
    };
    start();
    if (!enabled) return;
    return () => {
      cancelled = true;
    };
  }, [enabled, id]);
  return null;
};
