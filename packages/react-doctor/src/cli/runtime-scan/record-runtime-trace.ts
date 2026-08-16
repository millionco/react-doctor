import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { chromium } from "playwright-core";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright-core";
import { CliInputError } from "../utils/cli-input-error.js";
import { assertRuntimeScanInteractive } from "./assert-runtime-scan-interactive.js";
import {
  RUNTIME_SCAN_BROWSER_HEIGHT_PX,
  RUNTIME_SCAN_BROWSER_WIDTH_PX,
  RUNTIME_SCAN_PROBE_RELATIVE_PATH,
  RUNTIME_SCAN_TRACE_CATEGORIES,
  RUNTIME_SCAN_TRACE_FILE_MODE,
} from "./constants.js";
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
  await cdpSession.send("Tracing.start", {
    categories: RUNTIME_SCAN_TRACE_CATEGORIES.join(","),
    transferMode: "ReturnAsStream",
  });
};

const endDevtoolsTrace = async (cdpSession: CDPSession): Promise<string> => {
  const traceComplete = new Promise<{ stream?: string }>((resolve) => {
    cdpSession.once("Tracing.tracingComplete", resolve);
  });
  await cdpSession.send("Tracing.end");
  const { stream } = await traceComplete;
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
  const fileHandle = await fsp.open(tracePath, "w", RUNTIME_SCAN_TRACE_FILE_MODE);
  try {
    await fileHandle.chmod(RUNTIME_SCAN_TRACE_FILE_MODE);
    await pipeline(
      readDevtoolsTrace(cdpSession, stream),
      createGzip(),
      fileHandle.createWriteStream(),
    );
  } finally {
    await fileHandle.close().catch(() => {});
  }
};

const discardDevtoolsTrace = async (cdpSession: CDPSession): Promise<void> => {
  const stream = await endDevtoolsTrace(cdpSession);
  await cdpSession.send("IO.close", { handle: stream });
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
  } catch (cause) {
    const guidance =
      cdpUrl === undefined
        ? "Install Google Chrome, or pass --cdp <url> for a browser started with remote debugging."
        : "Confirm the browser is running with remote debugging and that the CDP URL is reachable.";
    throw new CliInputError(
      `Could not connect to Chrome. ${guidance} ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
};

export const recordRuntimeTrace = async (
  input: RecordRuntimeTraceInput,
): Promise<RecordRuntimeTraceResult> => {
  sanitizeRuntimeUrl(input.url);
  assertRuntimeScanInteractive();
  const capturedAtDate = new Date();
  const capturedAt = capturedAtDate.toISOString();
  const tracePath = resolveRuntimeTracePath(input.traceOut, capturedAtDate);
  const probeSource = await fsp.readFile(resolveProbePath(), "utf8");
  const startedAt = performance.now();
  const { browser, connection } = await connectToBrowser(input.cdpUrl);
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let cdpSession: CDPSession | undefined;
  let didCreateContext = false;
  let isTracing = false;

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
    await startDevtoolsTrace(cdpSession);
    isTracing = true;
    await page.goto(input.url, { waitUntil: "load" });
    await waitForRuntimeScanStop();
    const snapshot = await readProbeSnapshot(page);
    const traceStream = await endDevtoolsTrace(cdpSession);
    isTracing = false;
    await writeDevtoolsTrace(cdpSession, traceStream, tracePath);
    return {
      tracePath,
      capturedAt,
      durationMs: performance.now() - startedAt,
      snapshot,
      connection,
    };
  } finally {
    if (isTracing && cdpSession !== undefined) {
      await discardDevtoolsTrace(cdpSession).catch(() => {});
    }
    await page?.close().catch(() => {});
    if (connection === "cdp" && didCreateContext) {
      await context?.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  }
};
