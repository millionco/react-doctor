import { chromium, type Browser } from "playwright-core";
import { CONNECT_TIMEOUT_MS, DEFAULT_CDP_ENDPOINT } from "./constants.js";
import { launchPersistentChrome } from "./launch.js";
import type { BrowserConnectOptions } from "./types.js";
import { cdpPortFromEndpoint } from "./utils/cdp-port.js";
import { isLoopbackEndpoint } from "./utils/is-loopback-endpoint.js";

export interface BrowserConnection {
  browser: Browser;
  launched: boolean;
}

// Attach to a debuggable Chrome over CDP. If none is reachable on a local
// endpoint, launch our own persistent, reattachable instance and attach to
// that. We always end up attached over CDP — never holding a launched process
// handle — so the browser survives across commands, the model Chrome DevTools
// MCP uses to keep state.
export const connectToBrowser = async (
  options: BrowserConnectOptions = {},
): Promise<BrowserConnection> => {
  const endpoint = options.cdpEndpoint ?? DEFAULT_CDP_ENDPOINT;
  try {
    const browser = await chromium.connectOverCDP(endpoint, { timeout: CONNECT_TIMEOUT_MS });
    return { browser, launched: false };
  } catch (attachError) {
    // Only launch for a loopback endpoint — we can't spawn Chrome on a remote host.
    if (options.launch === false || !isLoopbackEndpoint(endpoint)) {
      throw new Error(
        `Could not attach to Chrome at ${endpoint}. Start Chrome with --remote-debugging-port=${cdpPortFromEndpoint(endpoint)}, or allow launching a local browser.`,
        { cause: attachError },
      );
    }
    const reachableEndpoint = await launchPersistentChrome(endpoint);
    try {
      return {
        browser: await chromium.connectOverCDP(reachableEndpoint, { timeout: CONNECT_TIMEOUT_MS }),
        launched: true,
      };
    } catch (launchedAttachError) {
      throw new Error(`Launched Chrome at ${reachableEndpoint} but could not attach to it.`, {
        cause: launchedAttachError,
      });
    }
  }
};
