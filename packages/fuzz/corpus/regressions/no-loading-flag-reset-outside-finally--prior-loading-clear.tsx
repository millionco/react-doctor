// rule: no-loading-flag-reset-outside-finally
// verdict: pass
// weakness: control-flow
// source: synthetic flag cleared before a second request
import { useState } from "react";

export function PreviewButton({
  loadPreview,
  warmCache,
}: {
  loadPreview: () => Promise<void>;
  warmCache: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true);
    try {
      await loadPreview();
    } finally {
      setLoading(false);
    }
    await warmCache();
    setLoading(false);
  };
  return (
    <button disabled={loading} onClick={refresh}>
      Refresh
    </button>
  );
}
