import {
  detectReactBuildType,
  getDisplayName,
  getRDTHook,
  getTimings,
  instrument,
  isCompositeFiber,
  onRendererInject,
  traverseRenderedFibers,
} from "bippy";
import type { Fiber, ReactRenderer } from "bippy";
import {
  RUNTIME_SCAN_INTERACTION_DURATION_THRESHOLD_MS,
  RUNTIME_SCAN_MAX_COMPONENT_EVENTS,
  RUNTIME_SCAN_MAX_COMPONENTS_PER_COMMIT,
  RUNTIME_SCAN_MAX_INTERACTIONS,
  RUNTIME_SCAN_MAX_LOAF_ENTRIES,
  RUNTIME_SCAN_MAX_SCRIPTS_PER_LOAF,
  RUNTIME_SCAN_MIN_COMPONENT_DURATION_MS,
} from "./constants.js";
import type {
  RuntimeScanComponentEvent,
  RuntimeScanInteraction,
  RuntimeScanLongAnimationFrame,
  RuntimeScanProbeSnapshot,
  RuntimeScanScriptTiming,
} from "./types.js";
import { recordRuntimeScanOverlayRender } from "./browser-overlay.js";

interface LongAnimationFrameScriptTiming {
  readonly invoker?: string;
  readonly invokerType?: string;
  readonly sourceURL?: string;
  readonly sourceFunctionName?: string;
  readonly sourceCharPosition?: number;
  readonly executionStart?: number;
  readonly duration?: number;
  readonly forcedStyleAndLayoutDuration?: number;
  readonly pauseDuration?: number;
}

interface LongAnimationFrameEntry extends PerformanceEntry {
  readonly blockingDuration?: number;
  readonly renderStart?: number;
  readonly styleAndLayoutStart?: number;
  readonly firstUIEventTimestamp?: number;
  readonly scripts?: ReadonlyArray<LongAnimationFrameScriptTiming>;
}

interface InteractionPerformanceEntry extends PerformanceEntry {
  readonly processingStart?: number;
  readonly processingEnd?: number;
  readonly interactionId?: number;
  readonly target?: Element | null;
}

interface LayoutShiftPerformanceEntry extends PerformanceEntry {
  readonly value?: number;
  readonly hadRecentInput?: boolean;
}

interface ReactPerformanceMeasure extends PerformanceMeasure {
  readonly detail: {
    readonly devtools?: {
      readonly track?: string;
      readonly reactDoctorSource?: string;
    };
  } | null;
}

interface RuntimeScanBrowserController {
  readonly snapshot: () => RuntimeScanProbeSnapshot;
}

interface RuntimeScanPerformanceObserverInit extends PerformanceObserverInit {
  readonly durationThreshold?: number;
}

interface RuntimeScanPerformanceObserver {
  readonly observer: PerformanceObserver;
  readonly listener: (entry: PerformanceEntry) => void;
}

declare global {
  interface Window {
    __REACT_DOCTOR_RUNTIME_SCAN__?: RuntimeScanBrowserController;
    __REACT_DOCTOR_RUNTIME_SCAN_CAPTURE__?: (snapshot: string) => void;
  }
}

const performanceObservers: RuntimeScanPerformanceObserver[] = [];
const longAnimationFrames: RuntimeScanLongAnimationFrame[] = [];
const componentEvents: RuntimeScanComponentEvent[] = [];
const interactions: RuntimeScanInteraction[] = [];
let cumulativeLayoutShift = 0;
let largestContentfulPaintMs: number | null = null;
let droppedLongAnimationFrames = 0;
let droppedScriptTimings = 0;
let droppedComponentEvents = 0;
let droppedInteractions = 0;
let reactDetected = false;
let reactVersion: string | null = null;
let reactBuildType: "development" | "production" | null = null;
let nativeReactTracks = false;
let bippyComponentTracks = false;

const sanitizeUrl = (rawUrl: string): string => {
  try {
    const parsedUrl = new URL(rawUrl, window.location.href);
    parsedUrl.username = "";
    parsedUrl.password = "";
    parsedUrl.search = "";
    parsedUrl.hash = "";
    return parsedUrl.href;
  } catch {
    return "";
  }
};

const pushLongAnimationFrame = (entry: RuntimeScanLongAnimationFrame): void => {
  if (longAnimationFrames.length >= RUNTIME_SCAN_MAX_LOAF_ENTRIES) {
    droppedLongAnimationFrames += 1;
    return;
  }
  longAnimationFrames.push(entry);
};

const pushComponentEvent = (entry: RuntimeScanComponentEvent): void => {
  if (componentEvents.length >= RUNTIME_SCAN_MAX_COMPONENT_EVENTS) {
    droppedComponentEvents += 1;
    return;
  }
  componentEvents.push(entry);
};

const observe = (
  entryType: string,
  listener: (entry: PerformanceEntry) => void,
  durationThresholdMs?: number,
): boolean => {
  try {
    const options: RuntimeScanPerformanceObserverInit = {
      type: entryType,
      buffered: true,
      durationThreshold: durationThresholdMs,
    };
    const observer = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) listener(entry);
    });
    observer.observe(options);
    performanceObservers.push({ observer, listener });
    return true;
  } catch {
    return false;
  }
};

const mapScriptTiming = (
  scriptTiming: LongAnimationFrameScriptTiming,
): RuntimeScanScriptTiming => ({
  invoker: scriptTiming.invoker ?? "",
  invokerType: scriptTiming.invokerType ?? "",
  sourceUrl: sanitizeUrl(scriptTiming.sourceURL ?? ""),
  sourceFunctionName: scriptTiming.sourceFunctionName ?? "",
  sourceCharPosition: scriptTiming.sourceCharPosition ?? 0,
  executionStart: scriptTiming.executionStart ?? 0,
  durationMs: scriptTiming.duration ?? 0,
  forcedStyleAndLayoutDurationMs: scriptTiming.forcedStyleAndLayoutDuration ?? 0,
  pauseDurationMs: scriptTiming.pauseDuration ?? 0,
});

const loafSupported = observe("long-animation-frame", (performanceEntry) => {
  const loafEntry = performanceEntry as LongAnimationFrameEntry;
  const scriptTimings = loafEntry.scripts ?? [];
  droppedScriptTimings += Math.max(0, scriptTimings.length - RUNTIME_SCAN_MAX_SCRIPTS_PER_LOAF);
  pushLongAnimationFrame({
    startTime: loafEntry.startTime,
    durationMs: loafEntry.duration,
    blockingDurationMs: loafEntry.blockingDuration ?? 0,
    renderStart: loafEntry.renderStart ?? 0,
    styleAndLayoutStart: loafEntry.styleAndLayoutStart ?? 0,
    firstUiEventTimestamp: loafEntry.firstUIEventTimestamp ?? 0,
    scripts: scriptTimings.slice(0, RUNTIME_SCAN_MAX_SCRIPTS_PER_LOAF).map(mapScriptTiming),
  });
});

observe(
  "event",
  (performanceEntry) => {
    const interactionEntry = performanceEntry as InteractionPerformanceEntry;
    const interactionId = interactionEntry.interactionId ?? 0;
    if (interactionId === 0) return;
    if (interactions.length >= RUNTIME_SCAN_MAX_INTERACTIONS) {
      droppedInteractions += 1;
      return;
    }
    interactions.push({
      name: interactionEntry.name,
      startTime: interactionEntry.startTime,
      durationMs: interactionEntry.duration,
      processingStart: interactionEntry.processingStart ?? interactionEntry.startTime,
      processingEnd: interactionEntry.processingEnd ?? interactionEntry.startTime,
      interactionId,
      targetTag: interactionEntry.target?.tagName ?? null,
    });
  },
  RUNTIME_SCAN_INTERACTION_DURATION_THRESHOLD_MS,
);

observe("layout-shift", (performanceEntry) => {
  const layoutShiftEntry = performanceEntry as LayoutShiftPerformanceEntry;
  if (layoutShiftEntry.hadRecentInput === true) return;
  cumulativeLayoutShift += layoutShiftEntry.value ?? 0;
});

observe("largest-contentful-paint", (performanceEntry) => {
  largestContentfulPaintMs = Math.max(largestContentfulPaintMs ?? 0, performanceEntry.startTime);
});

observe("measure", (performanceEntry) => {
  const measure = performanceEntry as ReactPerformanceMeasure;
  const devtools = measure.detail?.devtools;
  if (!devtools?.track?.includes("Components")) return;
  if (devtools.reactDoctorSource === "bippy") return;
  nativeReactTracks = true;
  pushComponentEvent({
    name: measure.name.replace(/^\u200B/, ""),
    startTime: measure.startTime,
    durationMs: measure.duration,
    depth: 0,
    source: "native",
  });
});

const versionHasNativeTracks = (version: string): boolean => {
  const [majorText, minorText] = version.split(".");
  const majorVersion = Number.parseInt(majorText ?? "", 10);
  const minorVersion = Number.parseInt(minorText ?? "", 10);
  return majorVersion > 19 || (majorVersion === 19 && minorVersion >= 2);
};

const attachRenderer = (renderer: ReactRenderer): void => {
  reactDetected = true;
  reactVersion = renderer.version;
  reactBuildType = detectReactBuildType(renderer);
};

const recordFallbackComponent = (fiber: Fiber, depth: number): void => {
  const { selfTime } = getTimings(fiber);
  if (selfTime < RUNTIME_SCAN_MIN_COMPONENT_DURATION_MS) return;
  const name = getDisplayName(fiber.type) ?? "Anonymous";
  const startTime = fiber.actualStartTime ?? performance.now() - selfTime;
  pushComponentEvent({
    name,
    startTime,
    durationMs: selfTime,
    depth,
    source: "bippy",
  });
  bippyComponentTracks = true;
  try {
    performance.measure(`\u200B${name}`, {
      start: startTime,
      duration: selfTime,
      detail: {
        devtools: {
          track: "Components ⚛",
          tooltipText: "React component render captured by React Doctor",
          reactDoctorSource: "bippy",
        },
      },
    });
    performance.clearMeasures(`\u200B${name}`);
  } catch {}
};

for (const renderer of getRDTHook().renderers.values()) attachRenderer(renderer);
onRendererInject(attachRenderer);

instrument({
  name: "react-doctor-runtime-scan",
  onCommitFiberRoot: (_rendererId, root) => {
    const shouldRecordFallbackTracks =
      reactVersion === null || !versionHasNativeTracks(reactVersion);
    let componentCount = 0;
    traverseRenderedFibers(root, (fiber) => {
      if (!isCompositeFiber(fiber)) return;
      if (componentCount >= RUNTIME_SCAN_MAX_COMPONENTS_PER_COMMIT) return;
      recordRuntimeScanOverlayRender(fiber);
      if (!shouldRecordFallbackTracks) {
        componentCount += 1;
        return;
      }
      let depth = 0;
      let parentFiber = fiber.return;
      while (parentFiber !== null) {
        depth += 1;
        parentFiber = parentFiber.return;
      }
      recordFallbackComponent(fiber, depth);
      componentCount += 1;
    });
  },
});

const snapshot = (): RuntimeScanProbeSnapshot => {
  for (const { observer, listener } of performanceObservers) {
    for (const entry of observer.takeRecords()) listener(entry);
  }
  return {
    timeOrigin: performance.timeOrigin,
    finalUrl: sanitizeUrl(window.location.href),
    support: {
      reactDetected,
      reactVersion,
      reactBuildType,
      nativeReactTracks,
      bippyComponentTracks,
      loaf: loafSupported,
    },
    longAnimationFrames: [...longAnimationFrames],
    componentEvents: [...componentEvents],
    interactions: [...interactions],
    cumulativeLayoutShift,
    largestContentfulPaintMs,
    droppedLongAnimationFrames,
    droppedScriptTimings,
    droppedComponentEvents,
    droppedInteractions,
  };
};

window.__REACT_DOCTOR_RUNTIME_SCAN__ = {
  snapshot,
};

const captureNavigationSnapshot = (): void => {
  if (window !== window.top) return;
  const captureSnapshot = window.__REACT_DOCTOR_RUNTIME_SCAN_CAPTURE__;
  if (captureSnapshot === undefined) return;
  captureSnapshot(JSON.stringify(snapshot()));
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") captureNavigationSnapshot();
});
window.addEventListener("beforeunload", captureNavigationSnapshot);
window.addEventListener("pagehide", captureNavigationSnapshot);
