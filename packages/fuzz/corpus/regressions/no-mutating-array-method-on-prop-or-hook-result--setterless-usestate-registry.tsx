// rule: no-mutating-array-method-on-prop-or-hook-result
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (timeouts provider: setter-less useState registry is a ref-like mutable container never read during render)
import * as React from "react";

export function TimeoutsProvider({ children }: { children: React.ReactNode }) {
  const [timeouts] = React.useState<number[]>([]);
  React.useEffect(
    () => () => {
      timeouts.forEach((tid) => window.clearTimeout(tid));
      timeouts.splice(0, timeouts.length);
    },
    [timeouts],
  );
  const context = React.useMemo(() => {
    const removeTimeout = (id: number) => {
      timeouts.splice(0, timeouts.length, ...timeouts.filter((tid) => tid !== id));
    };
    return { removeTimeout };
  }, [timeouts]);
  return <TimeoutsContext.Provider value={context}>{children}</TimeoutsContext.Provider>;
}

const TimeoutsContext = React.createContext<{ removeTimeout: (id: number) => void } | null>(null);
