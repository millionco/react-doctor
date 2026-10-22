// rule: no-set-state-after-await-in-effect
// verdict: fail
// weakness: control-flow
// source: synthetic
import { useEffect, useState } from "react";

export const ResourcePanel = ({ load, resourceId }) => {
  const [resource, setResource] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const run = async () => {
      const result = await load(resourceId, { signal: controller.signal });
      setResource(result);
    };
    void run();
    return () => controller.abort();
  }, [load, resourceId]);
  return <output>{String(resource)}</output>;
};
