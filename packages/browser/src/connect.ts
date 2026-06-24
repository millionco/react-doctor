import type { Browser } from "playwright-core";
import { BrowserEnvironmentError } from "./browser-environment-error.js";
import { CONNECT_TIMEOUT_MS, DEFAULT_CDP_ENDPOINT } from "./constants.js";
import { launchPersistentChrome } from "./launch.js";
import type { BrowserConnectOptions } from "./types.js";
import { cdpPortFromEndpoint } from "./utils/cdp-port.js";
import { clearLaunchedEndpoint } from "./utils/clear-launched-endpoint.js";
import { findAvailablePort } from "./utils/find-available-port.js";
import { isLoopbackEndpoint } from "./utils/is-loopback-endpoint.js";
import { isPortAvailable } from "./utils/is-port-available.js";
import { killProcess } from "./utils/kill-process.js";
import { loadPlaywright } from "./utils/load-playwright.js";
import { readLaunchedEndpoint } from "./utils/read-launched-endpoint.js";
import { writeLaunchedEndpoint } from "./utils/write-launched-endpoint.js";

export interface BrowserConnection {
  browser: Browser;
  launched: boolean;
}

// The endpoint to launch our own Chrome on. The default port is often held by
// another app (some Chromium-based browsers squat on 9222), and reusing a port
// we just failed to attach to is what doomed the launch — so when it isn't free,
// pick one that is. An explicit --cdp is honored exactly: the user asked for that
// port, so a busy one should surface as a clear failure, not move silently.
const resolveLaunchEndpoint = async (endpoint: string): Promise<string> => {
  const port = Number(cdpPortFromEndpoint(endpoint));
  if (await isPortAvailable(port)) return endpoint;
  const freePort = await findAvailablePort();
  const url = new URL(endpoint);
  url.port = String(freePort);
  return url.origin;
};

// Attach to a debuggable Chrome over CDP. If none is reachable on a local
// endpoint, launch our own persistent, reattachable instance and attach to
// that. We always end up attached over CDP — never holding a launched process
// handle — so the browser survives across commands, the model Chrome DevTools
// MCP uses to keep state.
export const connectToBrowser = async (
  options: BrowserConnectOptions = {},
): Promise<BrowserConnection> => {
  const { chromium } = await loadPlaywright();

  // Without an explicit --cdp, prefer the instance we previously launched (which
  // may be on a non-default port) before the well-known default.
  const launchedEndpoint = readLaunchedEndpoint();
  const attachCandidates = options.cdpEndpoint
    ? [options.cdpEndpoint]
    : launchedEndpoint && launchedEndpoint !== DEFAULT_CDP_ENDPOINT
      ? [launchedEndpoint, DEFAULT_CDP_ENDPOINT]
      : [DEFAULT_CDP_ENDPOINT];

  let lastAttachError: unknown;
  for (const candidate of attachCandidates) {
    try {
      const browser = await chromium.connectOverCDP(candidate, { timeout: CONNECT_TIMEOUT_MS });
      return { browser, launched: false };
    } catch (attachError) {
      lastAttachError = attachError;
    }
  }

  const fallbackEndpoint = options.cdpEndpoint ?? DEFAULT_CDP_ENDPOINT;
  // Only launch for a loopback endpoint — we can't spawn Chrome on a remote host.
  if (options.launch === false || !isLoopbackEndpoint(fallbackEndpoint)) {
    throw new BrowserEnvironmentError(
      `Could not attach to Chrome at ${fallbackEndpoint}. Start Chrome with --remote-debugging-port=${cdpPortFromEndpoint(fallbackEndpoint)}, or allow launching a local browser.`,
      { cause: lastAttachError },
    );
  }

  const launchEndpoint = options.cdpEndpoint
    ? options.cdpEndpoint
    : await resolveLaunchEndpoint(fallbackEndpoint);
  const launched = await launchPersistentChrome(launchEndpoint, options.headless ?? true);
  writeLaunchedEndpoint(launched.endpoint);
  try {
    return {
      browser: await chromium.connectOverCDP(launched.endpoint, { timeout: CONNECT_TIMEOUT_MS }),
      launched: true,
    };
  } catch (launchedAttachError) {
    // The debugger answered /json/version, yet the CDP handshake still failed
    // (usually a Chrome/playwright-core mismatch). Terminate the instance we
    // just spawned and forget its endpoint, so a retry doesn't attach-fail
    // against it again and stack another orphan Chrome on a fresh port.
    if (launched.pid !== undefined) killProcess(launched.pid);
    clearLaunchedEndpoint();
    throw new BrowserEnvironmentError(
      `Launched Chrome at ${launched.endpoint} but could not attach to it. Update Chrome (or playwright-core), or start Chrome yourself with --remote-debugging-port and pass --cdp.`,
      { cause: launchedAttachError },
    );
  }
};
