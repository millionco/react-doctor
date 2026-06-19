import { DEFAULT_CDP_PORT } from "../constants.js";

// Defaults to 9222 when the endpoint has no explicit port or can't be parsed.
export const cdpPortFromEndpoint = (endpoint: string): string => {
  const fallbackPort = String(DEFAULT_CDP_PORT);
  try {
    return new URL(endpoint).port || fallbackPort;
  } catch {
    return fallbackPort;
  }
};
