export interface RuntimeScanScriptTiming {
  readonly invoker: string;
  readonly invokerType: string;
  readonly sourceUrl: string;
  readonly sourceFunctionName: string;
  readonly sourceCharPosition: number;
  readonly executionStart: number;
  readonly durationMs: number;
  readonly forcedStyleAndLayoutDurationMs: number;
  readonly pauseDurationMs: number;
}

export interface RuntimeScanLongAnimationFrame {
  readonly startTime: number;
  readonly durationMs: number;
  readonly blockingDurationMs: number;
  readonly renderStart: number;
  readonly styleAndLayoutStart: number;
  readonly firstUiEventTimestamp: number;
  readonly scripts: ReadonlyArray<RuntimeScanScriptTiming>;
}

export interface RuntimeScanComponentEvent {
  readonly name: string;
  readonly startTime: number;
  readonly durationMs: number;
  readonly depth: number;
  readonly source: "native" | "bippy";
}

export interface RuntimeScanInteraction {
  readonly name: string;
  readonly startTime: number;
  readonly durationMs: number;
  readonly processingStart: number;
  readonly processingEnd: number;
  readonly interactionId: number;
  readonly documentIndex?: number;
  readonly targetTag: string | null;
}

export interface RuntimeScanProbeSupport {
  readonly reactDetected: boolean;
  readonly reactVersion: string | null;
  readonly reactBuildType: "development" | "production" | null;
  readonly nativeReactTracks: boolean;
  readonly bippyComponentTracks: boolean;
  readonly loaf: boolean;
}

export interface RuntimeScanProbeSnapshot {
  readonly timeOrigin: number;
  readonly finalUrl: string;
  readonly support: RuntimeScanProbeSupport;
  readonly longAnimationFrames: ReadonlyArray<RuntimeScanLongAnimationFrame>;
  readonly componentEvents: ReadonlyArray<RuntimeScanComponentEvent>;
  readonly interactions: ReadonlyArray<RuntimeScanInteraction>;
  readonly cumulativeLayoutShift: number;
  readonly largestContentfulPaintMs: number | null;
  readonly droppedLongAnimationFrames: number;
  readonly droppedScriptTimings: number;
  readonly droppedComponentEvents: number;
  readonly droppedInteractions: number;
}

export interface RuntimeScanScriptHotspot {
  readonly sourceUrl: string;
  readonly functionName: string;
  readonly sourceCharPosition: number;
  readonly invoker: string;
  readonly totalDurationMs: number;
  readonly maxDurationMs: number;
  readonly forcedStyleAndLayoutDurationMs: number;
  readonly frameCount: number;
}

export interface RuntimeScanComponentHotspot {
  readonly name: string;
  readonly source: "native" | "bippy";
  readonly renderCount: number;
  readonly totalDurationMs: number;
  readonly maxDurationMs: number;
}

export interface RuntimeScanSummary {
  readonly durationMs: number;
  readonly longAnimationFrameCount: number;
  readonly worstFrameDurationMs: number;
  readonly totalBlockingDurationMs: number;
  readonly interactionCount: number;
  readonly worstInteractionDurationMs: number;
  readonly cumulativeLayoutShift: number;
  readonly largestContentfulPaintMs: number | null;
}

export interface RuntimeScanReport {
  readonly schemaVersion: 1;
  readonly kind: "react-doctor-runtime-scan";
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly tracePath: string;
  readonly capturedAt: string;
  readonly timeOrigin: number;
  readonly connection: "isolated" | "cdp";
  readonly support: RuntimeScanProbeSupport;
  readonly summary: RuntimeScanSummary;
  readonly scriptHotspots: ReadonlyArray<RuntimeScanScriptHotspot>;
  readonly componentHotspots: ReadonlyArray<RuntimeScanComponentHotspot>;
  readonly longAnimationFrames: ReadonlyArray<RuntimeScanLongAnimationFrame>;
  readonly interactions: ReadonlyArray<RuntimeScanInteraction>;
  readonly warnings: ReadonlyArray<string>;
}

export interface RuntimeScanFlags {
  readonly format?: string;
  readonly traceOut?: string;
  readonly cdp?: string;
}

export interface RuntimeScanJsonlRecord {
  readonly schemaVersion: 1;
  readonly kind:
    | "metadata"
    | "summary"
    | "script-hotspot"
    | "component-hotspot"
    | "long-animation-frame"
    | "interaction";
  readonly data: unknown;
}
