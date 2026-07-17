// rule: no-loading-flag-reset-outside-finally
// weakness: alias-guard
import { useState } from "react";

export const Loader = () => {
  const [, setLoading] = useState(false);
  let request = async () => {
    try {
      await fetch("/safe");
    } catch {}
  };
  request = async () => fetch("/unsafe");
  const load = async () => {
    setLoading(true);
    await request();
    setLoading(false);
  };
  return <button onClick={load}>Load</button>;
};
