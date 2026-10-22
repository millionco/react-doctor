// rule: no-set-state-after-await-in-effect
// verdict: pass
// weakness: alias-guard
// source: synthetic
import { useEffect, useState } from "react";

export const ResourcePanel = ({ load, resourceId }) => {
  const [resource, setResource] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      const result = await load(resourceId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResource(result);
    };
    void run();
    return () => controller.abort();
  }, [load, resourceId]);
  return <output>{String(resource)}</output>;
};
