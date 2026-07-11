// rule: exhaustive-deps
// weakness: other
// source: RD-FP-016 task-perfection addendum (Mailing, 2026-07-11)
import { useMemo } from "react";

interface ApiKey {
  organizationId: string;
}

interface SettingsProps {
  apiKeys: ApiKey[];
  user: {
    organizationId: string;
  };
}

export const Settings = (props: SettingsProps) =>
  useMemo(
    () => props.apiKeys.filter((apiKey) => apiKey.organizationId === props.user.organizationId),
    [props.apiKeys, props.user.organizationId],
  );
