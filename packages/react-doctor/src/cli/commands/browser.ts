import {
  BrowserSession,
  closeLaunchedBrowser,
  DEFAULT_CODEGEN_FILENAME,
  DEFAULT_TRACE_FILENAME,
  DEFAULT_VIDEO_FILENAME,
  formatEvalValue,
  type AccessibilityViolation,
  type ConsoleMessageEntry,
  type CpuProfileAnalysis,
  type MemoryStats,
  type NetworkRequestEntry,
  type PageGeometry,
  type PageInspection,
  type PerformanceReport,
  type ReactProfileAnalysis,
  type TimelineAnalysis,
  type TimelinePhaseStat,
  type Viewport,
} from "@react-doctor/browser";
import {
  DEFAULT_SCREENSHOT_FILENAME,
  HEAVY_REQUEST_BYTES,
  METRIC,
  SLOW_REQUEST_MS,
} from "../utils/constants.js";
import { cliLogger as logger } from "../utils/cli-logger.js";
import { recordCount } from "../utils/record-metric.js";

export interface BrowserCommandOptions {
  cdp?: string;
  launch?: boolean;
  headed?: boolean;
  out?: string;
  viewport?: Viewport;
  profile?: boolean;
  codegen?: boolean;
  video?: boolean | string;
}

// Run `action` on the page, wrapping it in a screen recording when `--video` is
// set so any eval mode (plain, --profile, --codegen) can ship a playback .webm.
const recordIf = async <T>(
  session: BrowserSession,
  videoPath: string | null,
  action: () => Promise<T>,
): Promise<{ result: T; video: string | null }> => {
  if (!videoPath) return { result: await action(), video: null };
  return session.withVideo(videoPath, action);
};

// `--video` takes an optional path; bare `--video` records to the default file.
const resolveVideoPath = (video: boolean | string | undefined): string | null => {
  if (!video) return null;
  return typeof video === "string" ? video : DEFAULT_VIDEO_FILENAME;
};

// playwright-core loads lazily inside @react-doctor/browser (only when a command
// attaches to Chrome), so importing the session here costs nothing at startup
// and a missing install surfaces the package's own actionable hint.
const withSession = async (
  options: BrowserCommandOptions,
  useSession: (session: BrowserSession) => Promise<void>,
): Promise<void> => {
  const session = await BrowserSession.attach({
    cdpEndpoint: options.cdp,
    launch: options.launch,
    headless: options.headed ? false : undefined,
  });
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
        "Launched a dedicated headless Chrome (separate from your main profile); later browser commands reuse it. Run `react-doctor browser close` when done, or pass --headed to see the window.",
      );
    }
  });
};

export const browserCloseAction = async (): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, { command: "browser.close" });
  const closed = await closeLaunchedBrowser();
  if (closed) logger.success("Closed the launched browser.");
  else logger.log("No launched browser to close (it only stops the one React Doctor launched).");
};

export const browserEvalAction = async (
  expression: string | undefined,
  options: BrowserCommandOptions,
): Promise<void> => {
  recordCount(METRIC.cliInvoked, 1, {
    command: "browser.eval",
    codegen: options.codegen ? "true" : "false",
    video: options.video ? "true" : "false",
  });
  const videoPath = resolveVideoPath(options.video);
  const logVideo = (video: string | null): void => {
    if (video) logger.success(`Recorded video to ${video}`);
  };

  if (options.codegen) {
    if (expression === undefined) {
      logger.log("Pass an expression to generate a Playwright test from.");
      return;
    }
    const outPath = options.out ?? DEFAULT_CODEGEN_FILENAME;
    await withSession(options, async (session) => {
      const { result, video } = await recordIf(session, videoPath, () =>
        session.codegen({ expression, outPath }),
      );
      logger.log(result.output);
      logger.success(`Wrote Playwright test to ${result.path}`);
      logVideo(video);
    });
    return;
  }
  if (options.profile) {
    const tracePath = options.out ?? DEFAULT_TRACE_FILENAME;
    await withSession(options, async (session) => {
      const { result, video } = await recordIf(session, videoPath, () =>
        session.inspect({ expression, tracePath }),
      );
      printInspection(result);
      logVideo(video);
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
    const { result, video } = await recordIf(session, videoPath, () =>
      session.evaluateOrSnapshot(expression),
    );
    logger.log(result);
    logVideo(video);
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

// ` (123ms, 45.6kB)` from whichever of duration/size is known, or "" when
// neither is — a cache hit or a request that never finished in the window.
const formatRequestCost = (request: NetworkRequestEntry): string => {
  const parts: string[] = [];
  if (request.durationMs !== null) parts.push(`${request.durationMs}ms`);
  if (request.encodedBytes !== null) parts.push(`${(request.encodedBytes / 1024).toFixed(1)}kB`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
};

const printNetworkRequests = (requests: NetworkRequestEntry[]): void => {
  const failures = requests.filter(
    (request) => request.failure !== null || (request.status !== null && request.status >= 400),
  );
  const slow = requests.filter(
    (request) => request.durationMs !== null && request.durationMs >= SLOW_REQUEST_MS,
  );
  const heavy = requests.filter(
    (request) => request.encodedBytes !== null && request.encodedBytes >= HEAVY_REQUEST_BYTES,
  );
  for (const request of requests) {
    const outcome = request.failure ?? (request.status === null ? "pending" : request.status);
    logger.log(`${outcome} ${request.method} ${request.url}${formatRequestCost(request)}`);
  }
  const heavyMb = HEAVY_REQUEST_BYTES / 1024 / 1024;
  logger.log(
    `${requests.length} request(s), ${failures.length} failed, ${slow.length} slow (>${SLOW_REQUEST_MS}ms), ${heavy.length} heavy (>${heavyMb}MB)`,
  );
};

const printMemoryStats = (memory: MemoryStats): void => {
  const heapMb = (memory.jsHeapUsedBytes / 1024 / 1024).toFixed(1);
  const totalMb = (memory.jsHeapTotalBytes / 1024 / 1024).toFixed(1);
  logger.log(`JS heap: ${heapMb}MB used / ${totalMb}MB total`);
  logger.log(
    `${memory.domNodes} DOM nodes, ${memory.jsEventListeners} listeners, ${memory.documents} document(s), ${memory.frames} frame(s)`,
  );
};

// Scroll + viewport context. The scroll delta is only printed when the page
// actually moved during the action — that's the signal worth noticing (the
// viewport shifted under you), so a still page stays quiet.
const printGeometry = (geometry: PageGeometry): void => {
  logger.log(
    `Viewport: ${geometry.viewportWidth}x${geometry.viewportHeight} @ ${geometry.devicePixelRatio}x, scroll ${geometry.scrollX},${geometry.scrollY}`,
  );
  if (geometry.scrolledX !== 0 || geometry.scrolledY !== 0) {
    logger.log(
      `Page scrolled ${geometry.scrolledX},${geometry.scrolledY} during the action (the viewport moved under you)`,
    );
  }
};

const printPerformanceReport = (report: PerformanceReport): void => {
  const lcp = report.largestContentfulPaintMs;
  logger.log(`LCP: ${lcp === null ? "n/a" : `${lcp}ms`}   CLS: ${report.cumulativeLayoutShift}`);
  printTimelineAnalysis(report.timeline);
  if (report.longAnimationFrames.length === 0) {
    logger.log("No blocking long animation frames — no main-thread jank captured");
    return;
  }
  logger.log(
    `${report.longAnimationFrames.length} blocking long animation frame(s), most blocking first:`,
  );
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

  if (inspection.evalError !== null) {
    logger.log("# Eval error (the recording below is the failure's context)");
    logger.log(inspection.evalError);
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

  logger.log("\n# Memory");
  printMemoryStats(inspection.memory);
  printGeometry(inspection.geometry);

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
