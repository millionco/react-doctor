// rule: no-loading-flag-reset-outside-finally
// weakness: control-flow
// source: synthetic regression
// verdict: pass
import { useState } from "react";

export const Preview = ({ load }: { load: () => Promise<void> }) => {
  const [loading, setLoading] = useState(false);
  const update = async (withSpinner = false) => {
    if (withSpinner) setLoading(true);
    try {
      await load();
    } finally {
      if (withSpinner) setLoading(false);
    }
  };
  const start = () => void update(true);
  return (
    <button type="button" onClick={start}>
      {String(loading)}
    </button>
  );
};
