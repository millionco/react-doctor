import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { BrowserEnvironmentError } from "./browser-environment-error.js";
import {
  LAUNCH_POLL_INTERVAL_MS,
  LAUNCH_READY_TIMEOUT_MS,
  LAUNCHED_CHROME_PROFILE_DIRECTORY,
} from "./constants.js";
import { cdpPortFromEndpoint } from "./utils/cdp-port.js";
import { delay } from "./utils/delay.js";

const chromeExecutableCandidates = (): readonly string[] => {
  switch (process.platform) {
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      ];
    case "win32":
      return [
        `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
      ];
    default:
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/opt/google/chrome/chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ];
  }
};

const resolveChromeExecutable = (): string => {
  const candidates = [process.env.CHROME_PATH, ...chromeExecutableCandidates()];
  const executable = candidates.find(
    (candidate): candidate is string => typeof candidate === "string" && existsSync(candidate),
  );
  if (!executable) {
    throw new BrowserEnvironmentError(
      "Could not find Google Chrome to launch. Install Chrome, set CHROME_PATH, or start Chrome with --remote-debugging-port and pass --cdp to attach to it.",
    );
  }
  return executable;
};

// Chrome may bind the debug port on IPv4 or IPv6 depending on the host stack —
// notably it falls back to [::1] when 127.0.0.1 is already taken — so probe both
// loopback forms of the endpoint.
const loopbackVariants = (endpoint: string): readonly string[] => {
  const variants = new Set<string>([endpoint]);
  const url = new URL(endpoint);
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    url.hostname = "::1";
    variants.add(url.origin);
  }
  return [...variants];
};

// Returns the loopback form that actually responded so the caller attaches to
// the right one.
const waitForCdpEndpoint = async (endpoint: string): Promise<string> => {
  const candidates = loopbackVariants(endpoint);
  const deadline = Date.now() + LAUNCH_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const candidate of candidates) {
      try {
        const response = await fetch(new URL("/json/version", candidate));
        if (response.ok) return candidate;
      } catch {}
    }
    await delay(LAUNCH_POLL_INTERVAL_MS);
  }
  throw new BrowserEnvironmentError(
    `Launched Chrome but it never exposed its debugger at ${endpoint}. Start Chrome yourself with --remote-debugging-port and pass --cdp, or set CHROME_PATH to a working Chrome.`,
  );
};

// Detached and unref'd on success so the browser outlives this process and the
// next `browser` command reattaches over CDP — the persistent model Chrome
// DevTools MCP uses to keep state across calls. Headless by default (an agent
// rarely needs the window); `headless: false` shows it for a human to watch.
export const launchPersistentChrome = async (
  endpoint: string,
  headless: boolean,
): Promise<string> => {
  const executable = resolveChromeExecutable();
  const args = [
    `--remote-debugging-port=${cdpPortFromEndpoint(endpoint)}`,
    `--user-data-dir=${LAUNCHED_CHROME_PROFILE_DIRECTORY}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(headless ? ["--headless=new"] : []),
  ];

  const child = spawn(executable, args, { detached: true, stdio: "ignore" });
  // HACK: swallow async spawn errors (e.g. a non-executable binary) so they
  // don't crash the CLI as an uncaught exception; waitForCdpEndpoint surfaces
  // the failure as an actionable timeout instead.
  child.on("error", () => {});
  const reachableEndpoint = await waitForCdpEndpoint(endpoint).catch((error: unknown) => {
    child.kill();
    throw error;
  });
  child.unref();
  return reachableEndpoint;
};
