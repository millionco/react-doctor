import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Browser, CDPSession, ConsoleMessage, Page, Request, Response } from "playwright-core";
import { connectToBrowser, type BrowserConnection } from "./connect.js";
import {
  MAX_VIOLATION_TARGETS,
  NAVIGATION_TIMEOUT_MS,
  PERFORMANCE_OBSERVE_WINDOW_MS,
  REACT_PROFILER_INJECT_FILE,
  SETTLE_TIMEOUT_MS,
} from "./constants.js";
import { collectPerformanceReport } from "./perf-observer.js";
import type {
  AccessibilityViolation,
  BrowserConnectOptions,
  ConsoleMessageEntry,
  NetworkRequestEntry,
  PageInspection,
  PerformanceReport,
  Viewport,
} from "./types.js";

// Which signals to collect during a single capture load. Listeners and the perf
// observers all attach before one navigation, so any combination costs one load.
interface CaptureSignals {
  console: boolean;
  network: boolean;
  performance: boolean;
}

interface CaptureResult {
  console: ConsoleMessageEntry[];
  network: NetworkRequestEntry[];
  performance: PerformanceReport;
}

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

  async audit(url?: string): Promise<AccessibilityViolation[]> {
    if (url) {
      await this.navigate(url);
    } else {
      await this.settle();
    }
    return this.runAxe();
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

  // Arm every requested observer before a single navigation, drive that one
  // load, then read everything back — so capturing N signals costs ONE load,
  // not N. Listeners detach in `finally` so a navigation error can't leak them.
  private async runCapture(
    url: string | undefined,
    signals: CaptureSignals,
  ): Promise<CaptureResult> {
    const consoleEntries: ConsoleMessageEntry[] = [];
    const networkByRequest = new Map<Request, NetworkRequestEntry>();
    const detachers: Array<() => void> = [];
    if (signals.console) detachers.push(this.collectConsole(consoleEntries));
    if (signals.network) detachers.push(this.collectNetwork(networkByRequest));
    let performance = emptyPerformanceReport();
    try {
      await this.navigate(url);
      // Measure perf inside the try so console/network listeners stay attached
      // through its observation window (the collector waits internally), catching
      // post-load errors and requests. `buffered: true` replays the load's frames.
      if (signals.performance) performance = await this.measureCurrentPerformance();
    } finally {
      for (const detach of detachers) detach();
    }
    return { console: consoleEntries, network: [...networkByRequest.values()], performance };
  }

  // A per-page watermark inside collectPerformanceReport keeps a repeated
  // no-reload measurement from re-counting frames an earlier command already
  // reported on the same persistent page.
  private measureCurrentPerformance(): Promise<PerformanceReport> {
    return this.page.evaluate(collectPerformanceReport, PERFORMANCE_OBSERVE_WINDOW_MS);
  }

  async captureConsole(url?: string): Promise<ConsoleMessageEntry[]> {
    const { console } = await this.runCapture(url, {
      console: true,
      network: false,
      performance: false,
    });
    return console;
  }

  async captureNetwork(url?: string): Promise<NetworkRequestEntry[]> {
    const { network } = await this.runCapture(url, {
      console: false,
      network: true,
      performance: false,
    });
    return network;
  }

  // Without a `url`, measure the page as it is now with no reload — a reload
  // would wipe a just-performed `eval` interaction and its jank.
  async measurePerformance(url?: string): Promise<PerformanceReport> {
    if (url) {
      const { performance } = await this.runCapture(url, {
        console: false,
        network: false,
        performance: true,
      });
      return performance;
    }
    return this.measureCurrentPerformance();
  }

  async inspectPage(url?: string): Promise<PageInspection> {
    const capture = await this.runCapture(url, {
      console: true,
      network: true,
      performance: true,
    });
    return {
      console: capture.console,
      network: capture.network,
      performance: capture.performance,
      accessibility: await this.runAxe(),
    };
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
