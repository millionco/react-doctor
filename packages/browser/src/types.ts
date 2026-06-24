export interface BrowserConnectOptions {
  // Default http://127.0.0.1:9222. On attach failure (unless `launch` is false)
  // a local endpoint launches our own persistent Chrome instead.
  cdpEndpoint?: string;
  launch?: boolean;
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

export interface PerformanceReport {
  longAnimationFrames: LongAnimationFrame[];
  largestContentfulPaintMs: number | null;
  cumulativeLayoutShift: number;
}

// The full runtime picture from one `inspect` pass: the driven expression's
// return value plus every signal recorded while it ran.
export interface PageInspection {
  // The `expression`'s return value, or null when none was driven or it had none.
  result: unknown;
  console: ConsoleMessageEntry[];
  network: NetworkRequestEntry[];
  performance: PerformanceReport;
  accessibility: AccessibilityViolation[];
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
