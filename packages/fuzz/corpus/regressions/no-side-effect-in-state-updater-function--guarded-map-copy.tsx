// rule: no-side-effect-in-state-updater-function
// weakness: private copy-on-write collections
import { useState } from "react";

const createData = (version: number) => ({
  version,
  counters: new Map<string, number>(),
});

export const Counter = ({ version }: { version: number }) => {
  const [data, setData] = useState(() => createData(version));
  const increment = () =>
    setData((previous) => {
      const base = previous.version === version ? previous : createData(version);
      let counters = base.counters;
      for (const key of ["opens", "views"]) {
        const value = counters.get(key);
        if (value === undefined) {
          if (counters === base.counters) counters = new Map(counters);
          counters.set(key, 1);
        }
      }
      if (base === previous && counters === base.counters) return previous;
      return { ...base, counters };
    });
  return <button onClick={increment}>{data.counters.size}</button>;
};
