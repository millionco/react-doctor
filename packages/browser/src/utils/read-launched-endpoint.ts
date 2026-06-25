import { readFileSync } from "node:fs";
import { LAUNCHED_CHROME_ENDPOINT_FILE } from "../constants.js";

// The endpoint of the Chrome we last launched, so a later command reattaches to
// that same instance (which may be on a non-default port) before trying the
// well-known default. Best-effort: a missing file just means none was launched.
export const readLaunchedEndpoint = (): string | null => {
  try {
    const endpoint = readFileSync(LAUNCHED_CHROME_ENDPOINT_FILE, "utf8").trim();
    return endpoint.length > 0 ? endpoint : null;
  } catch {
    return null;
  }
};
