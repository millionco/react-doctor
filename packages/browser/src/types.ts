export interface BrowserConnectOptions {
  // Default http://127.0.0.1:9222. On attach failure (unless `launch` is false)
  // a local endpoint launches our own persistent Chrome instead.
  cdpEndpoint?: string;
  launch?: boolean;
  // Only applies to the Chrome we launch ourselves (not a browser we attach to):
  // launch it headless unless explicitly false. Defaults to headless.
  headless?: boolean;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface AccessibilityViolation {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  targets: string[];
}

export interface ConsoleMessageEntry {
  type: string;
  text: string;
  location: string | null;
}

export interface NetworkRequestEntry {
  method: string;
  url: string;
  resourceType: string;
  status: number | null;
  failure: string | null;
  // Wall time from request start to response end in ms (Playwright resource
  // timing), or null if the request never finished within the recording window.
  durationMs: number | null;
  // Encoded response body size in bytes, or null when unknown (still pending, or
  // served from cache with no transfer). The "heavy request" signal.
  encodedBytes: number | null;
}

export interface PerformanceScriptAttribution {
  sourceUrl: string;
  sourceFunctionName: string;
  invokerType: string;
  durationMs: number;
  forcedStyleAndLayoutMs: number;
}

// A frame that took >50ms.
export interface LongAnimationFrame {
  startTimeMs: number;
  durationMs: number;
  blockingDurationMs: number;
  scripts: PerformanceScriptAttribution[];
}

// One timeline phase rolled up from the Chrome DevTools trace: how much wall
// time the page spent in it during the recording, and the single longest event.
export interface TimelinePhaseStat {
  totalMs: number;
  count: number;
  longestMs: number;
}

// Forced reflows show up in the timeline trace as style-recalc / layout /
// hit-test events; this is where `getComputedStyle` / `getBoundingClientRect` /
// `elementsFromPoint` cost lands, which the script-level LoAF rows can't isolate.
export interface TimelineAnalysis {
  styleRecalc: TimelinePhaseStat;
  layout: TimelinePhaseStat;
  hitTest: TimelinePhaseStat;
  paint: TimelinePhaseStat;
}

export interface PerformanceReport {
  longAnimationFrames: LongAnimationFrame[];
  largestContentfulPaintMs: number | null;
  cumulativeLayoutShift: number;
  timeline: TimelineAnalysis;
}

// A point-in-time snapshot of the page's runtime footprint, read from the CDP
// Performance domain after the driven action. Growth across repeated `inspect`
// runs on the same persistent page is the leak signal: detached DOM keeps
// `domNodes` climbing, leaked closures keep `jsEventListeners`/`jsHeapUsedBytes`
// climbing, and orphaned iframes keep `documents`/`frames` climbing.
export interface MemoryStats {
  jsHeapUsedBytes: number;
  jsHeapTotalBytes: number;
  domNodes: number;
  jsEventListeners: number;
  documents: number;
  frames: number;
}

// The page's scroll + viewport state around the driven action. `scrolledX/Y` is
// how far the page scrolled while the expression ran — a large value means the
// action moved the viewport under you (auto-scroll, focus jump, scroll-into-
// view), which can masquerade as an element moving or resizing. `devicePixelRatio`
// and the viewport size also confirm a `--viewport` emulation took effect. Note:
// this is native page scroll only — an app with its own camera/pan (a canvas
// editor) won't show its movement here.
export interface PageGeometry {
  scrollX: number;
  scrollY: number;
  scrolledX: number;
  scrolledY: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

// Everything `inspect` observes that the page itself reports (LoAF / LCP / CLS),
// before the trace-derived `timeline` is folded in to form the PerformanceReport.
export type PageVitals = Omit<PerformanceReport, "timeline">;

export interface InspectOptions {
  // Async expression with the Playwright `page` in scope, driven while recording.
  expression?: string;
  // Where to write the raw Chrome DevTools timeline trace (loadable in the
  // DevTools Performance panel). Omit to skip writing the file.
  tracePath?: string;
}

// The full runtime picture from one `inspect` pass: the driven expression's
// return value plus every signal recorded while it ran.
export interface PageInspection {
  // The `expression`'s return value, or null when none was driven or it had none.
  result: unknown;
  // The message of the error the driven expression threw, or null when it
  // succeeded. A failing action still returns the recorded picture (console, CPU,
  // React, …) rather than throwing it away — that picture is the failure's context.
  evalError: string | null;
  console: ConsoleMessageEntry[];
  network: NetworkRequestEntry[];
  performance: PerformanceReport;
  memory: MemoryStats;
  geometry: PageGeometry;
  accessibility: AccessibilityViolation[];
  // Absolute path the raw timeline trace was written to, or null when none was.
  tracePath: string | null;
  profile: ProfileAnalysis;
}

export interface ReactComponentRenderStat {
  name: string;
  renderCount: number;
  totalSelfMs: number;
  totalActualMs: number;
  maxSelfMs: number;
  // Renders where nothing this component owns changed — not a first mount, no
  // hook/state/props/context change — so it re-rendered only because a parent
  // did. These are the memo / useCallback / context-split targets.
  unnecessaryRenderCount: number;
}

export interface ReactProfileCommitStat {
  commitIndex: number;
  durationMs: number;
  // Components that rendered in this commit, slowest self-time first.
  components: string[];
}

export interface ReactProfileAnalysis {
  rootCount: number;
  commitCount: number;
  totalCommitDurationMs: number;
  // Total wasted renders across all components (see ReactComponentRenderStat).
  unnecessaryRenderCount: number;
  topComponents: ReactComponentRenderStat[];
  slowestCommits: ReactProfileCommitStat[];
}

export interface CpuProfileFunctionStat {
  functionName: string;
  // Source `url:line` (1-based), or null for V8 synthetic frames ((idle), etc.).
  url: string | null;
  selfMs: number;
  selfPercent: number;
}

export interface CpuProfileAnalysis {
  durationMs: number;
  sampleCount: number;
  // Functions ranked by self time — where JS wall time actually went, the same
  // signal as DevTools' bottom-up view.
  topFunctions: CpuProfileFunctionStat[];
}

// One recording, both lenses: the React render profile (which components
// re-rendered and why) and the V8 CPU profile (which JS functions cost time).
// `react` is null on a production React build or a page without the profiler.
export interface ProfileAnalysis {
  react: ReactProfileAnalysis | null;
  cpu: CpuProfileAnalysis;
}
