import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright-core";
import { activeScanAbortRegistry } from "../utils/active-scan-abort-registry.js";
import { CliInputError } from "../utils/cli-input-error.js";
import { assertRuntimeScanInteractive } from "./assert-runtime-scan-interactive.js";
import {
  RUNTIME_SCAN_BROWSER_HEIGHT_PX,
  RUNTIME_SCAN_BROWSER_WIDTH_PX,
  RUNTIME_SCAN_PROBE_SNAPSHOT_BINDING_NAME,
  RUNTIME_SCAN_PROBE_RELATIVE_PATH,
  RUNTIME_SCAN_TRACE_CATEGORIES,
  RUNTIME_SCAN_TRACE_FILE_MODE,
  RUNTIME_SCAN_TRACING_COMPLETE_TIMEOUT_MS,
} from "./constants.js";
import { mergeRuntimeScanProbeSnapshots } from "./merge-runtime-scan-probe-snapshots.js";
import { resolveRuntimeTracePath } from "./resolve-runtime-trace-path.js";
import { sanitizeRuntimeUrl } from "./sanitize-runtime-url.js";
import type { RuntimeScanProbeSnapshot } from "./types.js";
import { waitForRuntimeScanStop } from "./wait-for-runtime-scan-stop.js";

export interface RecordRuntimeTraceInput {
  readonly url: string;
  readonly traceOut?: string;
  readonly cdpUrl?: string;
}

export interface RecordRuntimeTraceResult {
  readonly tracePath: string;
  readonly capturedAt: string;
  readonly durationMs: number;
  readonly snapshot: RuntimeScanProbeSnapshot;
  readonly connection: "isolated" | "cdp";
}

const resolveProbePath = (): string => {
  const candidates = [
    path.join(import.meta.dirname, RUNTIME_SCAN_PROBE_RELATIVE_PATH),
    path.resolve(import.meta.dirname, "../../../dist", RUNTIME_SCAN_PROBE_RELATIVE_PATH),
  ];
  const probePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (probePath === undefined) {
    throw new Error("The runtime scan browser probe is missing. Rebuild react-doctor and retry.");
  }
  return probePath;
};

const readProbeSnapshot = async (page: Page): Promise<RuntimeScanProbeSnapshot> => {
  const snapshot = await page.evaluate(() => window.__REACT_DOCTOR_RUNTIME_SCAN__?.snapshot());
  if (snapshot === undefined) {
    throw new Error("The runtime scan browser probe did not initialize.");
  }
  return snapshot;
};

const startDevtoolsTrace = async (cdpSession: CDPSession): Promise<void> => {
  try {
    await cdpSession.send("Tracing.start", {
      categories: RUNTIME_SCAN_TRACE_CATEGORIES.join(","),
      transferMode: "ReturnAsStream",
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/Tracing (?:has )?already (?:been )?started/i.test(message)) {
      throw new CliInputError(
        "Chrome is already recording a performance trace. Stop the existing DevTools recording and retry.",
      );
    }
    throw cause;
  }
};

const endDevtoolsTrace = async (cdpSession: CDPSession): Promise<string> => {
  const traceComplete = new Promise<{ stream?: string }>((resolve) => {
    cdpSession.once("Tracing.tracingComplete", resolve);
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const traceTimeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error("Chrome did not finish the performance trace in time."));
    }, RUNTIME_SCAN_TRACING_COMPLETE_TIMEOUT_MS);
  });
  let stream: string | undefined;
  try {
    const finishTrace = async (): Promise<{ stream?: string }> => {
      await cdpSession.send("Tracing.end");
      return traceComplete;
    };
    ({ stream } = await Promise.race([finishTrace(), traceTimeout]));
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
  if (stream === undefined) throw new Error("Chrome returned a trace without a data stream.");
  return stream;
};

const readDevtoolsTrace = async function* (
  cdpSession: CDPSession,
  stream: string,
): AsyncGenerator<Buffer> {
  let isComplete = false;
  try {
    while (!isComplete) {
      const result = await cdpSession.send("IO.read", { handle: stream });
      yield Buffer.from(result.data, result.base64Encoded === true ? "base64" : "utf8");
      isComplete = result.eof === true;
    }
  } finally {
    await cdpSession.send("IO.close", { handle: stream }).catch(() => {});
  }
};

const writeDevtoolsTrace = async (
  cdpSession: CDPSession,
  stream: string,
  tracePath: string,
): Promise<void> => {
  await fsp.mkdir(path.dirname(tracePath), { recursive: true });
  const temporaryTracePath = `${tracePath}.${randomUUID()}.tmp`;
  const fileHandle = await fsp.open(temporaryTracePath, "wx", RUNTIME_SCAN_TRACE_FILE_MODE);
  let didMoveTrace = false;
  try {
    await fileHandle.chmod(RUNTIME_SCAN_TRACE_FILE_MODE);
    await pipeline(
      readDevtoolsTrace(cdpSession, stream),
      createGzip(),
      fileHandle.createWriteStream({ autoClose: false }),
    );
    await fileHandle.sync();
    await fileHandle.close();
    await fsp.rename(temporaryTracePath, tracePath);
    didMoveTrace = true;
  } finally {
    await fileHandle.close().catch(() => {});
    if (!didMoveTrace) await fsp.rm(temporaryTracePath, { force: true }).catch(() => {});
  }
};

const connectToBrowser = async (
  cdpUrl: string | undefined,
): Promise<{ browser: Browser; connection: "isolated" | "cdp" }> => {
  try {
    if (cdpUrl !== undefined) {
      return {
        browser: await chromium.connectOverCDP(cdpUrl),
        connection: "cdp",
      };
    }
    return {
      browser: await chromium.launch({
        channel: "chrome",
        headless: false,
        args: ["--no-first-run", "--no-default-browser-check"],
      }),
      connection: "isolated",
    };
  } catch {
    const guidance =
      cdpUrl === undefined
        ? "Install Google Chrome, or pass --cdp <url> for a browser started with remote debugging."
        : "Confirm the browser is running with remote debugging and that the CDP URL is reachable.";
    throw new CliInputError(`Could not connect to Chrome. ${guidance}`);
  }
};

const navigateToRuntimeUrl = async (page: Page, url: string): Promise<void> => {
  try {
    await page.goto(url, { waitUntil: "load" });
  } catch {
    throw new CliInputError(
      "Could not load the target URL. Confirm the app is running and reachable from Chrome.",
    );
  }
};

export const recordRuntimeTrace = async (
  input: RecordRuntimeTraceInput,
): Promise<RecordRuntimeTraceResult> => {
  sanitizeRuntimeUrl(input.url);
  assertRuntimeScanInteractive();
  const tracePath = resolveRuntimeTracePath(input.traceOut, new Date());
  const probeSource = await fsp.readFile(resolveProbePath(), "utf8");
  const { browser, connection } = await connectToBrowser(input.cdpUrl);
  const navigationSnapshots: RuntimeScanProbeSnapshot[] = [];
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let cdpSession: CDPSession | undefined;
  let didCreateContext = false;
  let isTracing = false;
  let traceStreamPromise: Promise<string> | undefined;
  let cleanupPromise: Promise<void> | undefined;

  const stopTracing = async (): Promise<void> => {
    if (!isTracing || cdpSession === undefined) return;
    try {
      traceStreamPromise ??= endDevtoolsTrace(cdpSession);
      const traceStream = await traceStreamPromise;
      isTracing = false;
      await cdpSession.send("IO.close", { handle: traceStream });
    } catch {}
  };
  const closeBrowserResources = async (): Promise<void> => {
    await page?.close().catch(() => {});
    if (connection === "cdp" && didCreateContext) {
      await context?.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  };
  const cleanup = (): Promise<void> => {
    cleanupPromise ??= stopTracing().then(closeBrowserResources);
    return cleanupPromise;
  };
  const unregisterCleanup = activeScanAbortRegistry.registerCleanup(cleanup);

  try {
    if (connection === "cdp") {
      context = browser.contexts()[0];
    }
    if (context === undefined) {
      context = await browser.newContext({
        viewport: {
          width: RUNTIME_SCAN_BROWSER_WIDTH_PX,
          height: RUNTIME_SCAN_BROWSER_HEIGHT_PX,
        },
      });
      didCreateContext = true;
    }
    page = await context.newPage();
    await page.addInitScript({ content: probeSource });
    cdpSession = await context.newCDPSession(page);
    cdpSession.on("Runtime.bindingCalled", (event) => {
      if (event.name !== RUNTIME_SCAN_PROBE_SNAPSHOT_BINDING_NAME) return;
      try {
        const snapshot: RuntimeScanProbeSnapshot = JSON.parse(event.payload);
        if (
          typeof snapshot.timeOrigin !== "number" ||
          !Array.isArray(snapshot.longAnimationFrames) ||
          !Array.isArray(snapshot.componentEvents) ||
          !Array.isArray(snapshot.interactions)
        ) {
          return;
        }
        navigationSnapshots.push(snapshot);
      } catch {}
    });
    await cdpSession.send("Runtime.enable");
    await cdpSession.send("Runtime.addBinding", {
      name: RUNTIME_SCAN_PROBE_SNAPSHOT_BINDING_NAME,
    });
    await startDevtoolsTrace(cdpSession);
    isTracing = true;
    const capturedAt = new Date().toISOString();
    const recordingStartedAt = performance.now();
    await navigateToRuntimeUrl(page, input.url);
    await waitForRuntimeScanStop();
    const finalSnapshot = await readProbeSnapshot(page);
    traceStreamPromise = endDevtoolsTrace(cdpSession);
    const traceStream = await traceStreamPromise;
    const durationMs = performance.now() - recordingStartedAt;
    isTracing = false;
    await writeDevtoolsTrace(cdpSession, traceStream, tracePath);
    return {
      tracePath,
      capturedAt,
      durationMs,
      snapshot: mergeRuntimeScanProbeSnapshots([...navigationSnapshots, finalSnapshot]),
      connection,
    };
  } finally {
    await cleanup();
    unregisterCleanup();
  }
};
