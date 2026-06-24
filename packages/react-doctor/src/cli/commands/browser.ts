import {
  BrowserSession,
  DEFAULT_TRACE_FILENAME,
  formatEvalValue,
  type AccessibilityViolation,
  type ConsoleMessageEntry,
  type CpuProfileAnalysis,
  type NetworkRequestEntry,
  type PageInspection,
  type PerformanceReport,
  type ReactProfileAnalysis,
  type TimelineAnalysis,
  type TimelinePhaseStat,
  type Viewport,
} from "@react-doctor/browser";
import { DEFAULT_SCREENSHOT_FILENAME, METRIC } from "../utils/constants.js";
import { cliLogger as logger } from "../utils/cli-logger.js";
import { recordCount } from "../utils/record-metric.js";

export interface BrowserCommandOptions {
  cdp?: string;
  launch?: boolean;
  out?: string;
  viewport?: Viewport;
  profile?: boolean;
}

// playwright-core loads lazily inside @react-doctor/browser (only when a command
// attaches to Chrome), so importing the session here costs nothing at startup
// and a missing install surfaces the package's own actionable hint.
const withSession = async (
  options: BrowserCommandOptions,
  useSession: (session: BrowserSession) => Promise<void>,
): Promise<void> => {
  const session = await BrowserSession.attach({ cdpEndpoint: options.cdp, launch: options.launch });
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
    await session.openWithReactProfiler(url);
    logger.success(`Opened ${url}`);
    logger.log(
      "React profiler ready: `browser eval '<action>' --profile` records + analyzes that action, or drive it manually with `browser eval 'page.evaluate(() => window.__REACT_PERF__.start())'` then `stop()`.",
    );
    if (session.launched) {
      logger.log(
        "Launched a dedicated Chrome (separate from your main profile); later browser commands reuse it. Quit that window when you're done.",
      );
    }
  });
};

export const browserEvalAction = async (
  expression: string | undefined,
  options: BrowserCommandOptions,
): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "browser.eval" });
  if (options.profile) {
    const tracePath = options.out ?? DEFAULT_TRACE_FILENAME;
    await withSession(options, async (session) => {
      printInspection(await session.inspect({ expression, tracePath }));
    });
    return;
  }
  // Without --profile, an expression is required: guard before attaching (or
  // launching) Chrome so a bare `browser eval` doesn't spin one up to do nothing.
  if (expression === undefined) {
    logger.log("Pass an expression to run, or --profile to measure the page.");
    return;
  }
  await withSession(options, async (session) => {
    const result = await session.evaluate(expression);
    if (result === undefined) return;
    logger.log(formatEvalValue(result));
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

// Section printers for `eval --profile`, one per section of the inspection, so
// the line format lives in one place. `printInspection` owns the headers and the
// "(none)" line for the list sections that can be empty.
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
  printTimelineAnalysis(report.timeline);
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

// Trace-derived forced-reflow cost: each phase is the native style/layout/
// hit-test/paint wall time the recording spent, naming where reads on a dirty
// page land (getComputedStyle/getBoundingClientRect → style-recalc/layout;
// elementsFromPoint → hit-test). Phases with no events are dropped.
const printTimelineAnalysis = (timeline: TimelineAnalysis): void => {
  const phases: Array<[string, TimelinePhaseStat]> = [
    ["style-recalc", timeline.styleRecalc],
    ["layout", timeline.layout],
    ["hit-test", timeline.hitTest],
    ["paint", timeline.paint],
  ];
  const recorded = phases.filter(([, stat]) => stat.count > 0);
  if (recorded.length === 0) return;
  logger.log("Timeline (trace), forced-reflow cost:");
  for (const [label, stat] of recorded) {
    logger.log(`  ${label}: ${stat.totalMs}ms across ${stat.count} (longest ${stat.longestMs}ms)`);
  }
};

const printReactProfile = (analysis: ReactProfileAnalysis): void => {
  logger.log(
    `${analysis.commitCount} commit(s) across ${analysis.rootCount} root(s), ${analysis.totalCommitDurationMs}ms total render time, ${analysis.unnecessaryRenderCount} unnecessary render(s)`,
  );
  if (analysis.topComponents.length > 0) {
    logger.log("Hottest components (self time):");
    for (const component of analysis.topComponents) {
      const wasted =
        component.unnecessaryRenderCount > 0
          ? `, ${component.unnecessaryRenderCount} unnecessary`
          : "";
      logger.log(
        `  ${component.totalSelfMs}ms  ${component.name} — ${component.renderCount} render(s)${wasted}`,
      );
    }
  }
  if (analysis.slowestCommits.length > 0) {
    logger.log("Slowest commits:");
    for (const commit of analysis.slowestCommits) {
      logger.log(`  ${commit.durationMs}ms — ${commit.components.join(", ") || "(no components)"}`);
    }
  }
};

const printCpuProfile = (analysis: CpuProfileAnalysis): void => {
  logger.log(`${analysis.durationMs}ms profiled, ${analysis.sampleCount} sample(s)`);
  if (analysis.topFunctions.length > 0) {
    logger.log("Hottest functions (self time):");
    for (const fn of analysis.topFunctions) {
      const location = fn.url ? ` — ${fn.url}` : "";
      logger.log(`  ${fn.selfMs}ms (${fn.selfPercent}%)  ${fn.functionName}${location}`);
    }
  }
};

// The whole runtime picture from one `eval --profile` recording, printed
// section by section. Each section reuses the shared printers above.
const printInspection = (inspection: PageInspection): void => {
  if (inspection.result !== null) {
    logger.log("# Result");
    logger.log(formatEvalValue(inspection.result));
    logger.log("");
  }

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

  logger.log("\n# React renders");
  if (inspection.profile.react) {
    printReactProfile(inspection.profile.react);
  } else {
    logger.log(
      "(no React data — needs a development build of React and renders during the recording)",
    );
  }

  logger.log("\n# CPU");
  printCpuProfile(inspection.profile.cpu);

  if (inspection.tracePath) {
    logger.log(
      `\nTimeline trace written to ${inspection.tracePath} (load in DevTools → Performance).`,
    );
  }
};
