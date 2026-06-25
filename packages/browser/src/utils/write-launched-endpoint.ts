import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LAUNCHED_CHROME_ENDPOINT_FILE } from "../constants.js";

// Remember where the Chrome we just launched is reachable so the next command
// reattaches to it. Best-effort: an unwritable cache dir just means we fall back
// to the default endpoint (and relaunch if needed) next time.
export const writeLaunchedEndpoint = (endpoint: string): void => {
  try {
    mkdirSync(dirname(LAUNCHED_CHROME_ENDPOINT_FILE), { recursive: true });
    writeFileSync(LAUNCHED_CHROME_ENDPOINT_FILE, endpoint);
  } catch {}
};
