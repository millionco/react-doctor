// rule: no-fetch-response-used-without-status-check
// verdict: pass
// weakness: control-flow
// source: React Bench 0.9.6 exhaustive audit

interface ApiKeys {
  keys: string[];
}

const isApiKeyListResponse = (value: unknown): value is ApiKeys =>
  typeof value === "object" && value !== null && "keys" in value;

const isSuccessfulResponse = (response: Response): boolean => response.ok;

export const loadAfterParsing = async (): Promise<ApiKeys> => {
  const response = await fetch("/api/keys");
  const data: unknown = await response.json();
  if (!response.ok || !isApiKeyListResponse(data)) throw new Error("Unable to load keys");
  return data;
};

export const loadAfterHelperGuard = async (): Promise<unknown> => {
  const response = await fetch("/api/settings");
  if (!isSuccessfulResponse(response)) throw new Error("Unable to load settings");
  return response.json();
};
