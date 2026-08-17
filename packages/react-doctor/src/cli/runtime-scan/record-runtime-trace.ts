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
import { assertRuntimeScanCdpProfile } from "./assert-runtime-scan-cdp-profile.js";
import { assertRuntimeScanInteractive } from "./assert-runtime-scan-interactive.js";
import {
  RUNTIME_SCAN_BROWSER_HEIGHT_PX,
  RUNTIME_SCAN_BROWSER_WIDTH_PX,
  RUNTIME_SCAN_MAX_DOCUMENT_SNAPSHOTS,
  RUNTIME_SCAN_MAX_SNAPSHOT_PAYLOAD_BYTES,
  RUNTIME_SCAN_MAX_TRACE_BYTES,
  RUNTIME_SCAN_PROBE_RELATIVE_PATH,
  RUNTIME_SCAN_PROBE_SNAPSHOT_ATTRIBUTE_NAME_PLACEHOLDER,
  RUNTIME_SCAN_PROBE_SNAPSHOT_BINDING_NAME_PLACEHOLDER,
  RUNTIME_SCAN_PROBE_SNAPSHOT_TOKEN_PLACEHOLDER,
  RUNTIME_SCAN_SNAPSHOT_TIMEOUT_MS,
  RUNTIME_SCAN_TRACE_CATEGORIES,
  RUNTIME_SCAN_TRACE_FILE_MODE,
  RUNTIME_SCAN_TRACING_COMPLETE_TIMEOUT_MS,
} from "./constants.js";
import { mergeRuntimeScanProbeSnapshots } from "./merge-runtime-scan-probe-snapshots.js";
import {
  isRuntimeScanProbeSnapshot,
  parseRuntimeScanSnapshotPayload,
} from "./parse-runtime-scan-snapshot-payload.js";
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

interface RuntimeScanDroppedEvidence {
  droppedLongAnimationFrames: number;
  droppedScriptTimings: number;
  droppedComponentEvents: number;
  droppedInteractions: number;
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

const buildSnapshotRelaySource = (attributeName: string, bindingName: string): string => `
(() => {
  let didRelaySnapshot = false;
  const getSnapshotAttribute = Element.prototype.getAttribute;
  const removeSnapshotAttribute = Element.prototype.removeAttribute;
  const relaySnapshot = () => {
    const documentElement = document.documentElement;
    if (documentElement === null) return;
    const payload = getSnapshotAttribute.call(documentElement, ${JSON.stringify(attributeName)});
    removeSnapshotAttribute.call(documentElement, ${JSON.stringify(attributeName)});
    if (
      didRelaySnapshot ||
      typeof payload !== "string" ||
      payload.length > ${RUNTIME_SCAN_MAX_SNAPSHOT_PAYLOAD_BYTES}
    ) return;
    if (new TextEncoder().encode(payload).byteLength > ${
      RUNTIME_SCAN_MAX_SNAPSHOT_PAYLOAD_BYTES
    }) return;
    const captureBinding = Reflect.get(globalThis, ${JSON.stringify(bindingName)});
    if (typeof captureBinding !== "function") return;
    didRelaySnapshot = true;
    captureBinding(payload);
  };
  new MutationObserver(relaySnapshot).observe(document, {
    attributes: true,
    subtree: true,
    attributeFilter: [${JSON.stringify(attributeName)}],
  });
})();
`;

const readProbeSnapshot = async (page: Page): Promise<RuntimeScanProbeSnapshot | null> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const snapshotTimeout = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(null), RUNTIME_SCAN_SNAPSHOT_TIMEOUT_MS);
  });
  try {
    const snapshot = await Promise.race([
      page.evaluate(() => window.__REACT_DOCTOR_RUNTIME_SCAN__?.snapshot()).catch(() => null),
      snapshotTimeout,
    ]);
    return isRuntimeScanProbeSnapshot(snapshot) ? snapshot : null;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
};

const createFallbackSnapshot = (
  timeOrigin: number,
  finalUrl: string,
): RuntimeScanProbeSnapshot => ({
  timeOrigin,
  finalUrl,
  support: {
    reactDetected: false,
    reactVersion: null,
    reactBuildType: null,
    nativeReactTracks: false,
    bippyComponentTracks: false,
    loaf: false,
  },
  longAnimationFrames: [],
  componentEvents: [],
  interactions: [],
  cumulativeLayoutShift: 0,
  largestContentfulPaintMs: null,
  droppedLongAnimationFrames: 0,
  droppedScriptTimings: 0,
  droppedComponentEvents: 0,
  droppedInteractions: 0,
});

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
  let traceBytes = 0;
  try {
    while (!isComplete) {
      const result = await cdpSession.send("IO.read", { handle: stream });
      const chunk = Buffer.from(result.data, result.base64Encoded === true ? "base64" : "utf8");
      traceBytes += chunk.byteLength;
      if (traceBytes > RUNTIME_SCAN_MAX_TRACE_BYTES) {
        throw new CliInputError(
          "The DevTools trace exceeded the 512 MB safety limit. Record a shorter, focused interaction and retry.",
        );
      }
      yield chunk;
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
  let didMoveTrace = false;
  try {
    await pipeline(
      readDevtoolsTrace(cdpSession, stream),
      createGzip(),
      fs.createWriteStream(temporaryTracePath, {
        flags: "wx",
        mode: RUNTIME_SCAN_TRACE_FILE_MODE,
        flush: true,
      }),
    );
    await fsp.rename(temporaryTracePath, tracePath);
    didMoveTrace = true;
  } finally {
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
  const sanitizedRequestedUrl = sanitizeRuntimeUrl(input.url);
  assertRuntimeScanInteractive();
  const tracePath = resolveRuntimeTracePath(input.traceOut, new Date());
  const snapshotIdentifier = randomUUID().replaceAll("-", "");
  const snapshotBindingName = `${RUNTIME_SCAN_PROBE_SNAPSHOT_BINDING_NAME_PLACEHOLDER}_${snapshotIdentifier}`;
  const snapshotAttributeName = `${RUNTIME_SCAN_PROBE_SNAPSHOT_ATTRIBUTE_NAME_PLACEHOLDER}-${snapshotIdentifier}`;
  const snapshotRelayWorldName = `react-doctor-runtime-scan-${snapshotIdentifier}`;
  const snapshotToken = randomUUID();
  const probeSource = (await fsp.readFile(resolveProbePath(), "utf8"))
    .replaceAll(RUNTIME_SCAN_PROBE_SNAPSHOT_ATTRIBUTE_NAME_PLACEHOLDER, snapshotAttributeName)
    .replaceAll(RUNTIME_SCAN_PROBE_SNAPSHOT_TOKEN_PLACEHOLDER, snapshotToken);
  const snapshotRelaySource = buildSnapshotRelaySource(snapshotAttributeName, snapshotBindingName);
  const { browser, connection } = await connectToBrowser(input.cdpUrl);
  const navigationSnapshotsByTimeOrigin = new Map<number, RuntimeScanProbeSnapshot>();
  const discardedSnapshotEvidence: RuntimeScanDroppedEvidence = {
    droppedLongAnimationFrames: 0,
    droppedScriptTimings: 0,
    droppedComponentEvents: 0,
    droppedInteractions: 0,
  };
  const scanPages = new Set<Page>();
  const pageSetupPromises = new Map<Page, Promise<void>>();
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let latestPage: Page | undefined;
  let traceCdpSession: CDPSession | undefined;
  let didCreateContext = false;
  let isTracing = false;
  let traceStreamPromise: Promise<string> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let preexistingCdpPages: Page[] = [];

  const storeNavigationSnapshot = (snapshot: RuntimeScanProbeSnapshot): void => {
    const didReplaceSnapshot = navigationSnapshotsByTimeOrigin.delete(snapshot.timeOrigin);
    if (
      !didReplaceSnapshot &&
      navigationSnapshotsByTimeOrigin.size >= RUNTIME_SCAN_MAX_DOCUMENT_SNAPSHOTS
    ) {
      const oldestTimeOrigin = navigationSnapshotsByTimeOrigin.keys().next().value;
      if (oldestTimeOrigin !== undefined) {
        const discardedSnapshot = navigationSnapshotsByTimeOrigin.get(oldestTimeOrigin);
        if (discardedSnapshot !== undefined) {
          discardedSnapshotEvidence.droppedLongAnimationFrames +=
            discardedSnapshot.longAnimationFrames.length +
            discardedSnapshot.droppedLongAnimationFrames;
          discardedSnapshotEvidence.droppedScriptTimings +=
            discardedSnapshot.longAnimationFrames.reduce(
              (scriptCount, longAnimationFrame) => scriptCount + longAnimationFrame.scripts.length,
              0,
            ) + discardedSnapshot.droppedScriptTimings;
          discardedSnapshotEvidence.droppedComponentEvents +=
            discardedSnapshot.componentEvents.length + discardedSnapshot.droppedComponentEvents;
          discardedSnapshotEvidence.droppedInteractions +=
            discardedSnapshot.interactions.length + discardedSnapshot.droppedInteractions;
        }
        navigationSnapshotsByTimeOrigin.delete(oldestTimeOrigin);
      }
    }
    navigationSnapshotsByTimeOrigin.set(snapshot.timeOrigin, snapshot);
  };
  const initializeRuntimeScanPage = async (runtimePage: Page): Promise<void> => {
    if (context === undefined) throw new Error("The runtime scan browser context is unavailable.");
    const cdpSession = await context.newCDPSession(runtimePage);
    await cdpSession.send("Page.enable");
    cdpSession.on("Runtime.bindingCalled", (event) => {
      if (event.name !== snapshotBindingName) return;
      const snapshot = parseRuntimeScanSnapshotPayload(event.payload, snapshotToken);
      if (snapshot !== null) storeNavigationSnapshot(snapshot);
    });
    await cdpSession.send("Runtime.enable");
    await cdpSession.send("Runtime.addBinding", {
      name: snapshotBindingName,
      executionContextName: snapshotRelayWorldName,
    });
    await cdpSession.send("Page.addScriptToEvaluateOnNewDocument", {
      source: snapshotRelaySource,
      worldName: snapshotRelayWorldName,
    });
    const frameTree = await cdpSession.send("Page.getFrameTree");
    const isolatedWorld = await cdpSession.send("Page.createIsolatedWorld", {
      frameId: frameTree.frameTree.frame.id,
      worldName: snapshotRelayWorldName,
    });
    await cdpSession.send("Runtime.evaluate", {
      expression: snapshotRelaySource,
      contextId: isolatedWorld.executionContextId,
    });
  };
  const registerRuntimeScanPage = (runtimePage: Page): Promise<void> => {
    latestPage = runtimePage;
    scanPages.add(runtimePage);
    const existingSetup = pageSetupPromises.get(runtimePage);
    if (existingSetup !== undefined) return existingSetup;
    const setupPromise = initializeRuntimeScanPage(runtimePage);
    pageSetupPromises.set(runtimePage, setupPromise);
    void setupPromise.catch(() => {});
    return setupPromise;
  };
  const stopTracing = async (): Promise<void> => {
    if (!isTracing || traceCdpSession === undefined) return;
    try {
      traceStreamPromise ??= endDevtoolsTrace(traceCdpSession);
      const traceStream = await traceStreamPromise;
      isTracing = false;
      await traceCdpSession.send("IO.close", { handle: traceStream });
    } catch {}
  };
  const closeBrowserResources = async (): Promise<void> => {
    await Promise.all([...scanPages].map((runtimePage) => runtimePage.close().catch(() => {})));
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
      preexistingCdpPages = browser.contexts().flatMap((browserContext) => browserContext.pages());
      assertRuntimeScanCdpProfile(preexistingCdpPages.map((browserPage) => browserPage.url()));
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
    context.on("page", (runtimePage) => {
      void registerRuntimeScanPage(runtimePage);
    });
    await context.addInitScript({ content: probeSource });
    page = await context.newPage();
    if (connection === "cdp") {
      await Promise.all(
        preexistingCdpPages.map(async (browserPage) => {
          if (!browserPage.isClosed()) await browserPage.close();
        }),
      );
    }
    await registerRuntimeScanPage(page);
    traceCdpSession = await browser.newBrowserCDPSession();
    await startDevtoolsTrace(traceCdpSession);
    isTracing = true;
    const capturedAt = new Date().toISOString();
    const recordingStartedAt = performance.now();
    await navigateToRuntimeUrl(page, input.url);
    await waitForRuntimeScanStop();
    const durationMs = performance.now() - recordingStartedAt;
    await Promise.allSettled([...pageSetupPromises.values()]);
    const finalSnapshotsPromise = Promise.all([...scanPages].map(readProbeSnapshot));
    traceStreamPromise = endDevtoolsTrace(traceCdpSession);
    const [finalSnapshots, traceStream] = await Promise.all([
      finalSnapshotsPromise,
      traceStreamPromise,
    ]);
    for (const finalSnapshot of finalSnapshots) {
      if (finalSnapshot !== null) storeNavigationSnapshot(finalSnapshot);
    }
    isTracing = false;
    await writeDevtoolsTrace(traceCdpSession, traceStream, tracePath);
    const capturedSnapshots = [...navigationSnapshotsByTimeOrigin.values()];
    let fallbackFinalUrl = sanitizedRequestedUrl;
    try {
      if (latestPage !== undefined && !latestPage.isClosed()) {
        fallbackFinalUrl = sanitizeRuntimeUrl(latestPage.url());
      }
    } catch {}
    const mergedSnapshot =
      capturedSnapshots.length > 0
        ? mergeRuntimeScanProbeSnapshots(capturedSnapshots)
        : createFallbackSnapshot(Date.parse(capturedAt), fallbackFinalUrl);
    return {
      tracePath,
      capturedAt,
      durationMs,
      snapshot: {
        ...mergedSnapshot,
        droppedLongAnimationFrames:
          mergedSnapshot.droppedLongAnimationFrames +
          discardedSnapshotEvidence.droppedLongAnimationFrames,
        droppedScriptTimings:
          mergedSnapshot.droppedScriptTimings + discardedSnapshotEvidence.droppedScriptTimings,
        droppedComponentEvents:
          mergedSnapshot.droppedComponentEvents + discardedSnapshotEvidence.droppedComponentEvents,
        droppedInteractions:
          mergedSnapshot.droppedInteractions + discardedSnapshotEvidence.droppedInteractions,
      },
      connection,
    };
  } finally {
    await cleanup();
    unregisterCleanup();
  }
};
