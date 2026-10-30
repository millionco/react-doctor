// rule: no-set-state-after-await-in-effect
// weakness: framework-gating
// source: independent synthetic regression
// verdict: pass

import { useEffect, useState } from "react";

export const Preview = () => {
  const [value, setValue] = useState(null);
  const endpoint = import.meta.env.VITE_PUBLIC_ENDPOINT;
  useEffect(() => {
    const load = async () => {
      const next = await Promise.resolve("ready");
      setValue(next);
    };
    void load();
  }, [endpoint]);
  return <span>{value}</span>;
};
