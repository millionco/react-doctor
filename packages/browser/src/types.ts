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

export interface PageInspection {
  console: ConsoleMessageEntry[];
  network: NetworkRequestEntry[];
  performance: PerformanceReport;
  accessibility: AccessibilityViolation[];
}
