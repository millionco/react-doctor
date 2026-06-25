import { rmSync } from "node:fs";
import { LAUNCHED_CHROME_ENDPOINT_FILE } from "../constants.js";

// Forget the persisted launched-Chrome endpoint so the next command stops trying
// to reattach to it (called after we close that instance, or when it's stale).
export const clearLaunchedEndpoint = (): void => {
  try {
    rmSync(LAUNCHED_CHROME_ENDPOINT_FILE, { force: true });
  } catch {}
};
