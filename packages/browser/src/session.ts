import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Browser, CDPSession, ConsoleMessage, Page, Request, Response } from "playwright-core";
import { connectToBrowser, type BrowserConnection } from "./connect.js";
import { analyzeCpuProfile } from "./analyze-cpu-profile.js";
import {
  DEFAULT_CPU_SAMPLING_INTERVAL_US,
  MAX_VIOLATION_TARGETS,
  NAVIGATION_TIMEOUT_MS,
  PERFORMANCE_OBSERVE_WINDOW_MS,
  REACT_PROFILER_INJECT_FILE,
  SETTLE_TIMEOUT_MS,
} from "./constants.js";
import { collectPerformanceReport } from "./perf-observer.js";
import { analyzeReactProfile } from "./react-profiler/analyze-profile.js";
import type { ReactProfilerDataExport } from "./react-profiler/types/profiling-export.js";
import type {
  AccessibilityViolation,
  BrowserConnectOptions,
  ConsoleMessageEntry,
  NetworkRequestEntry,
  PageInspection,
  PerformanceReport,
  Viewport,
} from "./types.js";

const emptyPerformanceReport = (): PerformanceReport => ({
  longAnimationFrames: [],
  largestContentfulPaintMs: null,
  cumulativeLayoutShift: 0,
});

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

  // The expression runs here in Node with the Playwright `page` in scope (the
  // whole driver API), not in the page — so an agent acts on what `snapshot`
  // showed it using Playwright's own selectors.
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const run = new Function("page", `"use strict"; return (async () => (${expression}))();`) as (
      page: Page,
    ) => Promise<T>;
    return run(this.page);
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

  // A per-page watermark inside collectPerformanceReport keeps a repeated
  // no-reload measurement from re-counting frames an earlier command already
  // reported on the same persistent page.
  private measureCurrentPerformance(): Promise<PerformanceReport> {
    return this.page.evaluate(collectPerformanceReport, PERFORMANCE_OBSERVE_WINDOW_MS);
  }

  // Drive the current page (optionally running `expression` — the same Playwright
  // code `evaluate` takes) while recording the whole runtime picture in one pass:
  // console + network listeners, a V8 CPU profile (the literal Chrome DevTools
  // profiler over CDP), the React DevTools render profile, page performance, and
  // an accessibility audit. This never navigates on its own — drive a fresh load
  // with `inspect("page.goto('...')")`, or `open` a URL first then inspect an
  // action on it. React data is null on a production build or a page not opened
  // with the profiler; it covers the driven action, not the initial mount.
  async inspect(expression?: string): Promise<PageInspection> {
    const consoleEntries: ConsoleMessageEntry[] = [];
    const networkByRequest = new Map<Request, NetworkRequestEntry>();
    // Open the CDP session before attaching listeners: if `newCDPSession` throws,
    // the listeners are never bound, so they can't leak onto the persistent page.
    const cdpSession = await this.page.context().newCDPSession(this.page);
    const detachers: Array<() => void> = [];
    try {
      detachers.push(this.collectConsole(consoleEntries), this.collectNetwork(networkByRequest));
      await this.settle();
      await cdpSession.send("Profiler.enable");
      await cdpSession.send("Profiler.setSamplingInterval", {
        interval: DEFAULT_CPU_SAMPLING_INTERVAL_US,
      });
      await cdpSession.send("Profiler.start");

      const reactStarted = await this.page.evaluate(() => {
        if (!globalThis.__REACT_PERF__) return false;
        globalThis.__REACT_PERF__.start();
        return true;
      });

      let result: unknown = null;
      let performance = emptyPerformanceReport();
      let reactExport: ReactProfilerDataExport | null = null;
      try {
        if (expression) result = (await this.evaluate(expression)) ?? null;
        // The perf observe window doubles as the recording window: it runs after
        // the driven action so post-action jank, React commits (concurrent
        // renders land async), and CPU samples all land before we stop.
        performance = await this.measureCurrentPerformance();
      } finally {
        // Always stop the React profiler, even if the expression threw: the
        // renderer profiles the persistent page, and `start()` no-ops while
        // already profiling, so a left-running recording would skew later runs
        // until the page reloads.
        if (reactStarted) {
          reactExport = await this.page
            .evaluate(() => globalThis.__REACT_PERF__?.stop() ?? null)
            .catch(() => null);
        }
      }

      const { profile } = await cdpSession.send("Profiler.stop");

      // Detach the page listeners before the accessibility audit so axe's injected
      // evaluate (and anything it logs) can't land in the captured signals.
      for (const detach of detachers) detach();
      detachers.length = 0;
      const accessibility = await this.runAxe();

      return {
        result,
        console: consoleEntries,
        network: [...networkByRequest.values()],
        performance,
        accessibility,
        profile: {
          react: reactExport ? analyzeReactProfile(reactExport) : null,
          cpu: analyzeCpuProfile(profile),
        },
      };
    } finally {
      // Stop V8 sampling before disabling, so a throw before the happy-path
      // `Profiler.stop` above can't leave the persistent page recording and skew
      // later runs. A second stop after a clean run just returns an ignored
      // profile, so this is safe on every path.
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
