import type {
  AccessibilityViolation,
  BrowserSession,
  ConsoleMessageEntry,
  NetworkRequestEntry,
  PerformanceReport,
  Viewport,
} from "@react-doctor/browser";
import { DEFAULT_SCREENSHOT_FILENAME, METRIC } from "../utils/constants.js";
import { cliLogger as logger } from "../utils/cli-logger.js";
import { recordCount } from "../utils/record-metric.js";

export interface BrowserCommandOptions {
  cdp?: string;
  launch?: boolean;
  out?: string;
  viewport?: Viewport;
}

const isModuleNotFoundError = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND");

// playwright-core is heavy and only the browser jobs need it, so it's an
// optional dependency loaded on demand. A missing install becomes an actionable
// hint; any other failure (a real bug in the browser package) rethrows as-is.
const loadBrowser = async (): Promise<typeof import("@react-doctor/browser")> => {
  try {
    return await import("@react-doctor/browser");
  } catch (error: unknown) {
    if (!isModuleNotFoundError(error)) throw error;
    throw new Error(
      "The browser tools need playwright-core, which isn't installed. Install it with `npm i -D playwright-core`, then retry.",
    );
  }
};

const withSession = async (
  options: BrowserCommandOptions,
  useSession: (session: BrowserSession) => Promise<void>,
): Promise<void> => {
  const { BrowserSession: Session } = await loadBrowser();
  const session = await Session.attach({ cdpEndpoint: options.cdp, launch: options.launch });
  try {
    if (options.viewport) await session.setViewport(options.viewport);
    await useSession(session);
  } finally {
    await session.dispose();
  }
};

export const browserOpenAction = async (
  url: string,
  options: BrowserCommandOptions,
): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "browser.open" });
  await withSession(options, async (session) => {
    // Wires the DevTools profiler before the page's React loads, drives this one
    // load, then removes the init-script registration — so it doesn't stack on
    // repeated opens or re-run on a later `perf`/`report` navigation in the same
    // persistent Chrome. The page persists, so later `eval`s reach
    // `window.__REACT_PERF__`.
    await session.openWithReactProfiler(url);
    logger.success(`Opened ${url}`);
    logger.log(
      "React profiler ready: `browser eval 'page.evaluate(() => window.__REACT_PERF__.start())'`, run a scenario, then `stop()` for the DevTools profiling export.",
    );
    if (session.launched) {
      logger.log(
        "Launched a dedicated Chrome (separate from your main profile); later browser commands reuse it. Quit that window when you're done.",
      );
    }
  });
};

export const browserEvalAction = async (
  expression: string,
  options: BrowserCommandOptions,
): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "browser.eval" });
  await withSession(options, async (session) => {
    const result = await session.evaluate(expression);
    if (result === undefined) return;
    logger.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  });
};

export const browserSnapshotAction = async (options: BrowserCommandOptions): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "browser.snapshot" });
  await withSession(options, async (session) => {
    logger.log(await session.snapshot());
  });
};

export const browserScreenshotAction = async (options: BrowserCommandOptions): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "browser.screenshot" });
  const outputPath = options.out ?? DEFAULT_SCREENSHOT_FILENAME;
  await withSession(options, async (session) => {
    await session.screenshot(outputPath);
    logger.success(`Saved ${outputPath}`);
  });
};

// Section printers, shared by the focused commands and the combined `report` so
// the line format lives in one place. Each prints the section body only; the
// callers decide on headers and empty-state messaging.
const printAuditViolations = (violations: AccessibilityViolation[]): void => {
  for (const violation of violations) {
    const impact = violation.impact ? `[${violation.impact}] ` : "";
    logger.log(`${impact}${violation.id} — ${violation.help}`);
    logger.log(`  ${violation.helpUrl}`);
    for (const target of violation.targets) logger.log(`  ${target}`);
  }
};

const printConsoleMessages = (messages: ConsoleMessageEntry[]): void => {
  for (const message of messages) {
    const location = message.location ? ` (${message.location})` : "";
    logger.log(`[${message.type}] ${message.text}${location}`);
  }
};

const printNetworkRequests = (requests: NetworkRequestEntry[]): void => {
  const failures = requests.filter(
    (request) => request.failure !== null || (request.status !== null && request.status >= 400),
  );
  for (const request of requests) {
    const outcome = request.failure ?? (request.status === null ? "pending" : request.status);
    logger.log(`${outcome} ${request.method} ${request.url}`);
  }
  logger.log(`${requests.length} request(s), ${failures.length} failed`);
};

const printPerformanceReport = (report: PerformanceReport): void => {
  const lcp = report.largestContentfulPaintMs;
  logger.log(`LCP: ${lcp === null ? "n/a" : `${lcp}ms`}   CLS: ${report.cumulativeLayoutShift}`);
  if (report.longAnimationFrames.length === 0) {
    logger.log("No long animation frames (>50ms) — no main-thread jank captured");
    return;
  }
  logger.log(`${report.longAnimationFrames.length} long animation frame(s), worst first:`);
  for (const frame of report.longAnimationFrames) {
    logger.log(
      `${frame.durationMs}ms frame (blocking ${frame.blockingDurationMs}ms) @ ${frame.startTimeMs}ms`,
    );
    for (const script of frame.scripts) {
      const functionName = script.sourceFunctionName || "(anonymous)";
      const reflow =
        script.forcedStyleAndLayoutMs > 0 ? `, ${script.forcedStyleAndLayoutMs}ms sync layout` : "";
      logger.log(
        `  ${script.durationMs}ms ${functionName} — ${script.sourceUrl || "(inline)"}${reflow}`,
      );
    }
  }
};

export const browserAuditAction = async (
  url: string | undefined,
  options: BrowserCommandOptions,
): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "browser.audit" });
  await withSession(options, async (session) => {
    const violations = await session.audit(url);
    if (violations.length === 0) {
      logger.success("No accessibility violations found");
      return;
    }
    logger.log(`${violations.length} accessibility violation(s):\n`);
    printAuditViolations(violations);
  });
};

export const browserConsoleAction = async (
  url: string | undefined,
  options: BrowserCommandOptions,
): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "browser.console" });
  await withSession(options, async (session) => {
    const messages = await session.captureConsole(url);
    if (messages.length === 0) {
      logger.success("No console output captured");
      return;
    }
    printConsoleMessages(messages);
  });
};

export const browserNetworkAction = async (
  url: string | undefined,
  options: BrowserCommandOptions,
): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "browser.network" });
  await withSession(options, async (session) => {
    const requests = await session.captureNetwork(url);
    if (requests.length === 0) {
      logger.success("No network requests captured");
      return;
    }
    printNetworkRequests(requests);
  });
};

export const browserPerfAction = async (
  url: string | undefined,
  options: BrowserCommandOptions,
): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "browser.perf" });
  await withSession(options, async (session) => {
    printPerformanceReport(await session.measurePerformance(url));
  });
};

// One navigation, every signal — the efficient path when an agent wants the
// whole runtime picture instead of reloading the page once per command.
export const browserReportAction = async (
  url: string | undefined,
  options: BrowserCommandOptions,
): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "browser.report" });
  await withSession(options, async (session) => {
    const inspection = await session.inspectPage(url);

    logger.log("# Console");
    if (inspection.console.length === 0) logger.log("(none)");
    else printConsoleMessages(inspection.console);

    logger.log("\n# Network");
    if (inspection.network.length === 0) logger.log("(none)");
    else printNetworkRequests(inspection.network);

    logger.log("\n# Performance");
    printPerformanceReport(inspection.performance);

    logger.log("\n# Accessibility");
    if (inspection.accessibility.length === 0) logger.log("(none)");
    else printAuditViolations(inspection.accessibility);
  });
};
