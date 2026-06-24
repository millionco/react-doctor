import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Browser, CDPSession, ConsoleMessage, Page, Request, Response } from "playwright-core";
import { connectToBrowser, type BrowserConnection } from "./connect.js";
import { analyzeCpuProfile, type CdpCpuProfile } from "./analyze-cpu-profile.js";
import { analyzeTimelineTrace } from "./analyze-timeline-trace.js";
import {
  DEFAULT_CPU_SAMPLING_INTERVAL_US,
  MAX_VIOLATION_TARGETS,
  NAVIGATION_TIMEOUT_MS,
  PERFORMANCE_OBSERVE_WINDOW_MS,
  REACT_PROFILER_INJECT_FILE,
  SETTLE_TIMEOUT_MS,
  TIMELINE_TRACE_CATEGORIES,
} from "./constants.js";
import { collectPerformanceReport } from "./perf-observer.js";
import { appendEvalErrors } from "./utils/append-eval-errors.js";
import { compileEval } from "./utils/compile-eval.js";
import { enrichEvalError } from "./utils/enrich-eval-error.js";
import { formatEvalValue } from "./utils/format-eval-value.js";
import { writeTraceFile } from "./utils/write-trace-file.js";
import { analyzeReactProfile } from "./react-profiler/analyze-profile.js";
import type { ReactProfilerDataExport } from "./react-profiler/types/profiling-export.js";
import type {
  AccessibilityViolation,
  BrowserConnectOptions,
  ConsoleMessageEntry,
  CpuProfileAnalysis,
  InspectOptions,
  MemoryStats,
  NetworkRequestEntry,
  PageGeometry,
  PageInspection,
  PageVitals,
  Viewport,
} from "./types.js";

const emptyVitals = (): PageVitals => ({
  longAnimationFrames: [],
  largestContentfulPaintMs: null,
  cumulativeLayoutShift: 0,
});

// Used only when `Profiler.stop` fails (the recording is otherwise still useful):
// the rest of the inspection — console, network, React, axe — shouldn't be lost
// over a CPU-profile hiccup, so the CPU lens degrades to empty instead of throwing.
const emptyCpuAnalysis = (): CpuProfileAnalysis => ({
  durationMs: 0,
  sampleCount: 0,
  topFunctions: [],
});

// When the CDP Performance domain is unavailable (older Chrome, a failed
// enable): a zeroed snapshot degrades the memory lens without losing the rest.
const emptyMemory = (): MemoryStats => ({
  jsHeapUsedBytes: 0,
  jsHeapTotalBytes: 0,
  domNodes: 0,
  jsEventListeners: 0,
  documents: 0,
  frames: 0,
});

// A Chrome DevTools trace event as it streams over CDP (loosely typed there as a
// string map). The full record — every field — is written to the trace file; the
// roll-up only reads `name`/`dur`, which it narrows itself.
interface TraceEventRecord {
  [key: string]: unknown;
}

const resolveActivePage = async (browser: Browser): Promise<Page> => {
  for (const context of browser.contexts()) {
    const [firstPage] = context.pages();
    if (firstPage) return firstPage;
  }
  const context = browser.contexts()[0] ?? (await browser.newContext());
  return context.newPage();
};

// A live handle to the attached page. The page state lives in the browser, so a
// session is cheap to create per command and there is no server to keep alive.
export class BrowserSession {
  // Held so the device-metrics override is cleared on dispose rather than
  // relying on the override happening to reset when the CDP client disconnects
  // — otherwise an emulated viewport could linger on the persistent Chrome.
  private viewportOverride: CDPSession | null = null;

  private constructor(
    private readonly connection: BrowserConnection,
    readonly page: Page,
  ) {}

  static async attach(options: BrowserConnectOptions = {}): Promise<BrowserSession> {
    const connection = await connectToBrowser(options);
    const page = await resolveActivePage(connection.browser);
    return new BrowserSession(connection, page);
  }

  get launched(): boolean {
    return this.connection.launched;
  }

  async open(url: string): Promise<void> {
    await this.navigate(url);
  }

  // Open `url` with the React DevTools profiler wired in. The init script has to
  // run before the page's React loads (the only moment the hook can attach), so
  // register it, drive this one load, then remove the registration. Leaving it
  // registered would linger in the persistent Chrome we only attached to:
  // stacking another copy on every `browser open` (each a separate script that
  // re-installs the backend) and re-running on a later command's navigation. The
  // page it just loaded keeps `window.__REACT_PERF__` for subsequent `eval`s.
  async openWithReactProfiler(url: string): Promise<void> {
    const injectUrl = new URL(REACT_PROFILER_INJECT_FILE, import.meta.url);
    const source = await readFile(injectUrl, "utf8").catch(() => null);
    if (source === null) {
      throw new Error(
        `React profiler init script missing at ${fileURLToPath(injectUrl)}; rebuild @react-doctor/browser.`,
      );
    }
    const cdpSession = await this.page.context().newCDPSession(this.page);
    await cdpSession.send("Page.enable");
    const { identifier } = await cdpSession.send("Page.addScriptToEvaluateOnNewDocument", {
      source,
    });
    try {
      await this.navigate(url);
    } finally {
      await cdpSession
        .send("Page.removeScriptToEvaluateOnNewDocument", { identifier })
        .catch(() => {});
      await cdpSession.detach().catch(() => {});
    }
  }

  private async navigate(url?: string): Promise<void> {
    const options = { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: "domcontentloaded" } as const;
    await (url ? this.page.goto(url, options) : this.page.reload(options));
    await this.settle();
  }

  // A CDP device-metrics override, not page.setViewportSize, so it works on a
  // page we only attached to — it never resizes the user's real window. The
  // session is kept and cleared in dispose() so the override doesn't linger.
  async setViewport(viewport: Viewport): Promise<void> {
    const cdpSession = await this.page.context().newCDPSession(this.page);
    await cdpSession.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    this.viewportOverride = cdpSession;
  }

  // The source runs here in Node with the Playwright `page` (the whole driver
  // API) in scope, not in the page — so an agent locates and acts with
  // Playwright's own selectors: `page.getByRole("button", { name: "Open" })
  // .click()`. A bare expression returns its value; multi-statement source works
  // too (see `compileEval`). Page globals (`window`, `document`, …) live in the
  // page, so reach them via `page.evaluate(...)`.
  async evaluate<T = unknown>(expression: string): Promise<T> {
    try {
      return await compileEval<T>(expression)(this.page);
    } catch (error) {
      throw enrichEvalError(error);
    }
  }

  // The driving path the CLI and MCP use: run the source, and when it was a pure
  // action (returned nothing) hand back the resulting accessibility tree so one
  // call both acts and shows the new page state — no follow-up `snapshot`. An
  // expression that returns a value yields that value instead. Page-side errors
  // the action triggered (console.error, an uncaught throw) are appended so a
  // silent failure can't slip past without the agent hand-wiring a console hook.
  async evaluateOrSnapshot(expression: string): Promise<string> {
    const consoleEntries: ConsoleMessageEntry[] = [];
    const detach = this.collectConsole(consoleEntries);
    try {
      const result = await this.evaluate(expression);
      const output = result === undefined ? await this.snapshot() : formatEvalValue(result);
      // HACK: one event-loop turn lets page-side console/pageerror events queued
      // during the action drain (CDP delivers them async) before we read them.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return appendEvalErrors(output, consoleEntries);
    } finally {
      detach();
    }
  }

  // Wait for the page to stop changing before we read it: in-flight requests
  // drain, then web fonts finish loading. Without this the design job
  // screenshots a half-rendered frame (lazy images, fade-in, fallback fonts).
  // Bounded and best-effort — a page that never goes idle hits the cap.
  private async settle(): Promise<void> {
    await this.page.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
    await this.waitForFonts();
  }

  // `document.fonts.ready` can stall on a page that keeps registering fonts, so
  // cap it — otherwise settle() (on the hot path of every command) could hang.
  private waitForFonts(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, SETTLE_TIMEOUT_MS);
      void this.page
        .evaluate(() => document.fonts?.ready.then(() => undefined))
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(timer);
          resolve();
        });
    });
  }

  async snapshot(): Promise<string> {
    return this.page.locator("body").ariaSnapshot();
  }

  // Settle first so a screenshot taken straight after an SPA navigation (or in a
  // separate command that reattaches) still captures the finished page.
  async screenshot(path?: string): Promise<Uint8Array> {
    await this.settle();
    return this.page.screenshot({ path });
  }

  // axe is injected with `evaluate`, not a <script> tag, so a strict CSP can't
  // block it. Loaded on demand so it stays out of bundles that don't audit.
  private async runAxe(): Promise<AccessibilityViolation[]> {
    const { default: axe } = await import("axe-core");
    await this.page.evaluate(axe.source);
    return this.page.evaluate(async (maxTargets) => {
      const runner: typeof axe = (globalThis as unknown as { axe: typeof axe }).axe;
      const results = await runner.run(document, { resultTypes: ["violations"] });
      return results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? null,
        help: violation.help,
        helpUrl: violation.helpUrl,
        targets: violation.nodes.slice(0, maxTargets).map((node) => node.target.join(" ")),
      }));
    }, MAX_VIOLATION_TARGETS);
  }

  // Listeners go on before navigation so load-time messages are seen; returns a
  // detach.
  private collectConsole(entries: ConsoleMessageEntry[]): () => void {
    const onConsole = (message: ConsoleMessage): void => {
      const { url: sourceUrl, lineNumber } = message.location();
      entries.push({
        type: message.type(),
        text: message.text(),
        location: sourceUrl ? `${sourceUrl}:${lineNumber}` : null,
      });
    };
    const onPageError = (error: Error): void => {
      entries.push({ type: "error", text: error.message, location: null });
    };
    this.page.on("console", onConsole);
    this.page.on("pageerror", onPageError);
    return () => {
      this.page.off("console", onConsole);
      this.page.off("pageerror", onPageError);
    };
  }

  private collectNetwork(entriesByRequest: Map<Request, NetworkRequestEntry>): () => void {
    const onRequest = (request: Request): void => {
      entriesByRequest.set(request, {
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        status: null,
        failure: null,
        durationMs: null,
        encodedBytes: null,
      });
    };
    const onResponse = (response: Response): void => {
      const entry = entriesByRequest.get(response.request());
      if (entry) entry.status = response.status();
    };
    const onRequestFailed = (request: Request): void => {
      const entry = entriesByRequest.get(request);
      if (entry) entry.failure = request.failure()?.errorText ?? "failed";
    };
    this.page.on("request", onRequest);
    this.page.on("response", onResponse);
    this.page.on("requestfailed", onRequestFailed);
    return () => {
      this.page.off("request", onRequest);
      this.page.off("response", onResponse);
      this.page.off("requestfailed", onRequestFailed);
    };
  }

  // Fold per-request timing and transfer size onto the listener-collected
  // entries: `timing()` is the page's own resource timing (sync), `sizes()`
  // resolves once the response is received, so this runs after the recording
  // window when the requests have settled. Best-effort per request — a still
  // in-flight one keeps its null duration/size rather than failing the inspect.
  private async finalizeNetwork(
    entriesByRequest: Map<Request, NetworkRequestEntry>,
  ): Promise<NetworkRequestEntry[]> {
    await Promise.all(
      [...entriesByRequest].map(async ([request, entry]) => {
        const responseEndMs = request.timing().responseEnd;
        entry.durationMs = responseEndMs > 0 ? Math.round(responseEndMs) : null;
        const sizes = await request.sizes().catch(() => null);
        entry.encodedBytes = sizes ? sizes.responseBodySize : null;
      }),
    );
    return [...entriesByRequest.values()];
  }

  // A per-page watermark inside collectPerformanceReport keeps a repeated
  // no-reload measurement from re-counting frames an earlier command already
  // reported on the same persistent page.
  private measureCurrentPerformance(): Promise<PageVitals> {
    return this.page.evaluate(collectPerformanceReport, PERFORMANCE_OBSERVE_WINDOW_MS);
  }

  // The page's native scroll offset, read before the action so `captureGeometry`
  // can report how far it moved while the action ran.
  private readScroll(): Promise<{ x: number; y: number }> {
    return this.page
      .evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
      .catch(() => ({ x: 0, y: 0 }));
  }

  // Post-action scroll + viewport state, plus how far the page scrolled during
  // the action (`scrolledX/Y`). A large scroll delta means the viewport moved
  // under you — useful context for "did the element move, or did the page?".
  private captureGeometry(scrollBefore: { x: number; y: number }): Promise<PageGeometry> {
    return this.page
      .evaluate(
        (before) => ({
          scrollX: Math.round(window.scrollX),
          scrollY: Math.round(window.scrollY),
          scrolledX: Math.round(window.scrollX - before.x),
          scrolledY: Math.round(window.scrollY - before.y),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        }),
        scrollBefore,
      )
      .catch(() => ({
        scrollX: 0,
        scrollY: 0,
        scrolledX: 0,
        scrolledY: 0,
        viewportWidth: 0,
        viewportHeight: 0,
        devicePixelRatio: 1,
      }));
  }

  // The page's current runtime footprint from the CDP Performance domain (heap,
  // DOM nodes, listeners, documents/frames) — the counters DevTools' Performance
  // monitor shows. A snapshot, not a window, so it reflects the post-action state.
  private async captureMemory(cdpSession: CDPSession): Promise<MemoryStats> {
    const result = await cdpSession.send("Performance.getMetrics").catch(() => null);
    if (!result) return emptyMemory();
    const valueByName = new Map(result.metrics.map((metric) => [metric.name, metric.value]));
    const read = (name: string): number => Math.round(valueByName.get(name) ?? 0);
    return {
      jsHeapUsedBytes: read("JSHeapUsedSize"),
      jsHeapTotalBytes: read("JSHeapTotalSize"),
      domNodes: read("Nodes"),
      jsEventListeners: read("JSEventListeners"),
      documents: read("Documents"),
      frames: read("Frames"),
    };
  }

  // Begin a best-effort DevTools timeline trace on the CDP session, returning a
  // `stop()` that resolves the collected events (empty if tracing never started),
  // so the caller can bracket exactly the recording window. Runs alongside the
  // Profiler domain — the categories deliberately exclude the V8 CPU profiler so
  // the two don't collide.
  private async startTimelineTrace(
    cdpSession: CDPSession,
  ): Promise<() => Promise<TraceEventRecord[]>> {
    const events: TraceEventRecord[] = [];
    const onData = (payload: { value?: TraceEventRecord[] }): void => {
      if (payload.value) events.push(...payload.value);
    };
    cdpSession.on("Tracing.dataCollected", onData);
    const started = await cdpSession
      .send("Tracing.start", {
        categories: TIMELINE_TRACE_CATEGORIES,
        transferMode: "ReportEvents",
      })
      .then(() => true)
      .catch(() => false);
    if (!started) {
      cdpSession.off("Tracing.dataCollected", onData);
      return async () => [];
    }
    let stopped = false;
    return async () => {
      if (stopped) return events;
      stopped = true;
      await new Promise<void>((resolve) => {
        cdpSession.once("Tracing.tracingComplete", () => resolve());
        cdpSession.send("Tracing.end").catch(() => resolve());
      });
      cdpSession.off("Tracing.dataCollected", onData);
      return events;
    };
  }

  // Drive the current page (optionally running `options.expression` — the same
  // Playwright code `evaluate` takes) while recording the whole runtime picture
  // in one pass: console + network listeners, a V8 CPU profile (the literal
  // Chrome DevTools profiler over CDP), a DevTools timeline trace (style/layout/
  // hit-test cost, written to `options.tracePath` and rolled up into the perf
  // report), the React DevTools render profile, page performance, and an
  // accessibility audit. This never navigates on its own — drive a fresh load
  // with `inspect({ expression: "page.goto('...')" })`, or `open` a URL first
  // then inspect an action on it. React data is null on a production build or a
  // page not opened with the profiler; it covers the driven action, not mount.
  async inspect(options: InspectOptions = {}): Promise<PageInspection> {
    const { expression, tracePath } = options;
    const consoleEntries: ConsoleMessageEntry[] = [];
    const networkByRequest = new Map<Request, NetworkRequestEntry>();
    // Open the CDP session before attaching listeners: if `newCDPSession` throws,
    // the listeners are never bound, so they can't leak onto the persistent page.
    const cdpSession = await this.page.context().newCDPSession(this.page);
    const detachers: Array<() => void> = [];
    let stopTimelineTrace: (() => Promise<TraceEventRecord[]>) | null = null;
    try {
      detachers.push(this.collectConsole(consoleEntries), this.collectNetwork(networkByRequest));
      await this.settle();
      await cdpSession.send("Performance.enable").catch(() => {});
      await cdpSession.send("Profiler.enable");
      await cdpSession.send("Profiler.setSamplingInterval", {
        interval: DEFAULT_CPU_SAMPLING_INTERVAL_US,
      });
      await cdpSession.send("Profiler.start");
      stopTimelineTrace = await this.startTimelineTrace(cdpSession);

      const reactStarted = await this.page.evaluate(() => {
        if (!globalThis.__REACT_PERF__) return false;
        globalThis.__REACT_PERF__.start();
        return true;
      });

      const scrollBefore = await this.readScroll();
      let result: unknown = null;
      let vitals = emptyVitals();
      let reactExport: ReactProfilerDataExport | null = null;
      let traceEvents: TraceEventRecord[] = [];
      let cpuProfile: CdpCpuProfile | null = null;
      try {
        if (expression) result = (await this.evaluate(expression)) ?? null;
        // The perf observe window doubles as the recording window: it runs after
        // the driven action so post-action jank, React commits (concurrent
        // renders land async), and CPU samples all land before we stop.
        vitals = await this.measureCurrentPerformance();
      } finally {
        // Stop the recorders BEFORE reading the React profile, and always (even
        // if the expression threw — a left-running recording on the persistent
        // page would skew later runs). The React export serializes its data
        // in-page (a large structured clone), so stopping the V8 CPU profiler
        // and the timeline trace first keeps that serialization out of the
        // user-facing profiles instead of dominating them as our own overhead.
        if (stopTimelineTrace) {
          traceEvents = await stopTimelineTrace().catch(() => []);
          stopTimelineTrace = null;
        }
        cpuProfile = (await cdpSession.send("Profiler.stop").catch(() => null))?.profile ?? null;
        if (reactStarted) {
          reactExport = await this.page
            .evaluate(() => globalThis.__REACT_PERF__?.stop() ?? null)
            .catch(() => null);
        }
      }

      const writtenTracePath =
        tracePath && traceEvents.length > 0 ? await writeTraceFile(tracePath, traceEvents) : null;

      // Read memory before axe runs so the snapshot reflects the app's footprint,
      // not axe's injected globals.
      const memory = await this.captureMemory(cdpSession);
      const geometry = await this.captureGeometry(scrollBefore);

      // Detach the page listeners before the accessibility audit so axe's injected
      // evaluate (and anything it logs) can't land in the captured signals.
      for (const detach of detachers) detach();
      detachers.length = 0;
      const network = await this.finalizeNetwork(networkByRequest);
      const accessibility = await this.runAxe();

      return {
        result,
        console: consoleEntries,
        network,
        performance: { ...vitals, timeline: analyzeTimelineTrace(traceEvents) },
        memory,
        geometry,
        accessibility,
        tracePath: writtenTracePath,
        profile: {
          react: reactExport ? analyzeReactProfile(reactExport) : null,
          cpu: cpuProfile ? analyzeCpuProfile(cpuProfile) : emptyCpuAnalysis(),
        },
      };
    } finally {
      // Stop the timeline trace and V8 sampling before disabling, so a throw
      // before the happy-path stops above can't leave the persistent page
      // recording and skew later runs. A second stop after a clean run is a
      // no-op / ignored, so this is safe on every path.
      if (stopTimelineTrace) await stopTimelineTrace().catch(() => []);
      await cdpSession.send("Profiler.stop").catch(() => {});
      await cdpSession.send("Profiler.disable").catch(() => {});
      await cdpSession.detach().catch(() => {});
      for (const detach of detachers) detach();
    }
  }

  // Drop our CDP connection. This only disconnects — it never kills the browser,
  // whether the user had it open or we launched it — so the page stays alive and
  // the next `browser` command reattaches to the same live session.
  async dispose(): Promise<void> {
    if (this.viewportOverride) {
      await this.viewportOverride.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
      await this.viewportOverride.detach().catch(() => {});
      this.viewportOverride = null;
    }
    await this.connection.browser.close().catch(() => {});
  }
}
