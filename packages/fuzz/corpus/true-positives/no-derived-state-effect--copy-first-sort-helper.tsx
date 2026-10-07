// rule: no-derived-state-effect
// weakness: wrapper-transparency
// source: React Bench fix-react-rdh-sofn-xyz-mailing-settings Jp9zWjq and Mf8qhaw

import { useEffect, useState } from "react";

interface ApiKey {
  id: string;
  createdAt: string;
}

const sortApiKeys = (apiKeys: ApiKey[]): ApiKey[] =>
  [...apiKeys].sort(
    (firstApiKey, secondApiKey) =>
      new Date(secondApiKey.createdAt).getTime() - new Date(firstApiKey.createdAt).getTime(),
  );

export const Settings = ({ initialApiKeys }: { initialApiKeys: ApiKey[] }) => {
  const [apiKeys] = useState(initialApiKeys);
  const [apiKeyRows, setApiKeyRows] = useState<string[]>([]);

  useEffect(() => {
    setApiKeyRows(sortApiKeys(apiKeys).map((apiKey) => apiKey.id));
  }, [apiKeys]);

  return <output>{apiKeyRows.join(",")}</output>;
};
