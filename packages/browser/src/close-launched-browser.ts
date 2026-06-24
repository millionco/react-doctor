import { CONNECT_TIMEOUT_MS } from "./constants.js";
import { clearLaunchedEndpoint } from "./utils/clear-launched-endpoint.js";
import { loadPlaywright } from "./utils/load-playwright.js";
import { readLaunchedEndpoint } from "./utils/read-launched-endpoint.js";

// Terminate the persistent Chrome we launched. `dispose()` only disconnects (the
// persistent model keeps the page alive across commands), so this is the one path
// that actually stops it — the cleanup a headless instance needs since there's no
// window to quit. It targets ONLY our recorded endpoint, never a browser the user
// started, so it can't kill their Chrome. Returns whether it closed anything.
export const closeLaunchedBrowser = async (): Promise<boolean> => {
  const endpoint = readLaunchedEndpoint();
  if (!endpoint) return false;
  const { chromium } = await loadPlaywright();
  const browser = await chromium
    .connectOverCDP(endpoint, { timeout: CONNECT_TIMEOUT_MS })
    .catch(() => null);
  // Couldn't attach: the instance may just be briefly unreachable, so keep the
  // endpoint rather than orphaning a still-running Chrome we've now forgotten. A
  // genuinely dead endpoint is harmless — the next launch overwrites it.
  if (!browser) return false;
  const cdpSession = await browser.newBrowserCDPSession();
  await cdpSession.send("Browser.close").catch(() => {});
  clearLaunchedEndpoint();
  return true;
};
