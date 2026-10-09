// rule: effect-needs-cleanup
// verdict: safe
import { useEffect } from "react";
import { useDataProvider } from "react-admin";
import type { ApiPlatformAdminDataProvider } from "@api-platform/admin";
export const useRecords = (resource, ids) => {
  const provider: ApiPlatformAdminDataProvider = useDataProvider();
  useEffect(() => {
    if (!resource || !ids) return;
    provider.subscribe(ids, () => update());
    return () => {
      if (resource) provider.unsubscribe(resource, ids);
    };
  }, [resource, ids, provider]);
};
