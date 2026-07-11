import { useState } from "react";

interface ApiKeyRecord {
  id: string;
}

interface ApiKeysProps {
  apiKeys: ApiKeyRecord[];
}

export const ApiKeys = ({ apiKeys }: ApiKeysProps) => {
  const [localApiKeys, setLocalApiKeys] = useState<ApiKeyRecord[]>([]);
  const mergedApiKeys = new Map(apiKeys.map((apiKey) => [apiKey.id, apiKey]));
  localApiKeys.forEach((apiKey) => mergedApiKeys.set(apiKey.id, apiKey));
  return (
    <button onClick={() => setLocalApiKeys([])}>
      {[...mergedApiKeys.values()].map((apiKey) => apiKey.id).join(",")}
    </button>
  );
};
