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
  RUNTIME_SCAN_MAX_STRING_LENGTH,
  RUNTIME_SCAN_MIN_COMPONENT_DURATION_MS,
  RUNTIME_SCAN_PROBE_SNAPSHOT_ATTRIBUTE_NAME_PLACEHOLDER,
  RUNTIME_SCAN_PROBE_SNAPSHOT_TOKEN_PLACEHOLDER,
  RUNTIME_SCAN_SNAPSHOT_CATEGORY_BUDGET_BYTES,
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

interface RuntimeScanBoundedEntries<Entry> {
  readonly entries: Entry[];
  nextIndex: number;
  dropped: number;
}

interface RuntimeScanBudgetedEntries<Entry> {
  readonly entries: ReadonlyArray<Entry>;
  readonly dropped: number;
}

declare global {
  interface Window {
    __REACT_DOCTOR_RUNTIME_SCAN__?: RuntimeScanBrowserController;
  }
}

const performanceObservers: RuntimeScanPerformanceObserver[] = [];
const snapshotTextEncoder = new TextEncoder();
const setSnapshotAttribute = Element.prototype.setAttribute;
const removeSnapshotAttribute = Element.prototype.removeAttribute;
const queueSnapshotAttributeRemoval = window.queueMicrotask.bind(window);
const longAnimationFrames: RuntimeScanBoundedEntries<RuntimeScanLongAnimationFrame> = {
  entries: [],
  nextIndex: 0,
  dropped: 0,
};
const componentEvents: RuntimeScanBoundedEntries<RuntimeScanComponentEvent> = {
  entries: [],
  nextIndex: 0,
  dropped: 0,
};
const interactions: RuntimeScanBoundedEntries<RuntimeScanInteraction> = {
  entries: [],
  nextIndex: 0,
  dropped: 0,
};
let cumulativeLayoutShift = 0;
let largestContentfulPaintMs: number | null = null;
let droppedScriptTimings = 0;
let reactDetected = false;
let reactVersion: string | null = null;
let reactBuildType: "development" | "production" | null = null;
let nativeReactTracks = false;
let bippyComponentTracks = false;
let didCaptureCurrentPageState = false;

const limitString = (value: string): string => value.slice(0, RUNTIME_SCAN_MAX_STRING_LENGTH);

const sanitizeUrl = (rawUrl: string): string => {
  try {
    const parsedUrl = new URL(rawUrl, window.location.href);
    parsedUrl.username = "";
    parsedUrl.password = "";
    parsedUrl.search = "";
    parsedUrl.hash = "";
    return limitString(parsedUrl.href);
  } catch {
    return "";
  }
};

const pushBoundedEntry = <Entry>(
  boundedEntries: RuntimeScanBoundedEntries<Entry>,
  limit: number,
  entry: Entry,
): void => {
  if (boundedEntries.entries.length < limit) {
    boundedEntries.entries.push(entry);
  } else {
    boundedEntries.entries[boundedEntries.nextIndex] = entry;
    boundedEntries.nextIndex = (boundedEntries.nextIndex + 1) % limit;
    boundedEntries.dropped += 1;
  }
};

const readBoundedEntries = <Entry>(
  boundedEntries: RuntimeScanBoundedEntries<Entry>,
): ReadonlyArray<Entry> => {
  if (boundedEntries.nextIndex === 0) return [...boundedEntries.entries];
  return [
    ...boundedEntries.entries.slice(boundedEntries.nextIndex),
    ...boundedEntries.entries.slice(0, boundedEntries.nextIndex),
  ];
};

const takeLatestEntriesWithinByteBudget = <Entry>(
  entries: ReadonlyArray<Entry>,
): RuntimeScanBudgetedEntries<Entry> => {
  let minimumEntryCount = 0;
  let maximumEntryCount = entries.length;
  while (minimumEntryCount < maximumEntryCount) {
    const candidateEntryCount = Math.ceil((minimumEntryCount + maximumEntryCount) / 2);
    const candidateEntries = entries.slice(entries.length - candidateEntryCount);
    const candidateBytes = snapshotTextEncoder.encode(JSON.stringify(candidateEntries)).byteLength;
    if (candidateBytes <= RUNTIME_SCAN_SNAPSHOT_CATEGORY_BUDGET_BYTES) {
      minimumEntryCount = candidateEntryCount;
    } else {
      maximumEntryCount = candidateEntryCount - 1;
    }
  }
  return {
    entries: entries.slice(entries.length - minimumEntryCount),
    dropped: entries.length - minimumEntryCount,
  };
};

const pushLongAnimationFrame = (entry: RuntimeScanLongAnimationFrame): void => {
  pushBoundedEntry(longAnimationFrames, RUNTIME_SCAN_MAX_LOAF_ENTRIES, entry);
};

const pushComponentEvent = (entry: RuntimeScanComponentEvent): void => {
  pushBoundedEntry(componentEvents, RUNTIME_SCAN_MAX_COMPONENT_EVENTS, entry);
};

const pushInteraction = (entry: RuntimeScanInteraction): void => {
  pushBoundedEntry(interactions, RUNTIME_SCAN_MAX_INTERACTIONS, entry);
};

const captureSnapshot = (snapshot: RuntimeScanProbeSnapshot): void => {
  const documentElement = document.documentElement;
  if (documentElement === null) return;
  try {
    setSnapshotAttribute.call(
      documentElement,
      RUNTIME_SCAN_PROBE_SNAPSHOT_ATTRIBUTE_NAME_PLACEHOLDER,
      JSON.stringify({
        token: RUNTIME_SCAN_PROBE_SNAPSHOT_TOKEN_PLACEHOLDER,
        snapshot,
      }),
    );
    queueSnapshotAttributeRemoval(() => {
      try {
        removeSnapshotAttribute.call(
          documentElement,
          RUNTIME_SCAN_PROBE_SNAPSHOT_ATTRIBUTE_NAME_PLACEHOLDER,
        );
      } catch {}
    });
  } catch {
    return;
  }
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
  invoker: limitString(scriptTiming.invoker ?? ""),
  invokerType: limitString(scriptTiming.invokerType ?? ""),
  sourceUrl: sanitizeUrl(scriptTiming.sourceURL ?? ""),
  sourceFunctionName: limitString(scriptTiming.sourceFunctionName ?? ""),
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
    pushInteraction({
      name: limitString(interactionEntry.name),
      startTime: interactionEntry.startTime,
      durationMs: interactionEntry.duration,
      processingStart: interactionEntry.processingStart ?? interactionEntry.startTime,
      processingEnd: interactionEntry.processingEnd ?? interactionEntry.startTime,
      interactionId,
      targetTag:
        interactionEntry.target === null || interactionEntry.target === undefined
          ? null
          : limitString(interactionEntry.target.tagName),
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
    name: limitString(measure.name.replace(/^\u200B/, "")),
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
  reactVersion = typeof renderer.version === "string" ? limitString(renderer.version) : null;
  reactBuildType = detectReactBuildType(renderer);
};

const recordFallbackComponent = (fiber: Fiber, depth: number): void => {
  const { selfTime } = getTimings(fiber);
  if (selfTime < RUNTIME_SCAN_MIN_COMPONENT_DURATION_MS) return;
  const name = limitString(getDisplayName(fiber.type) ?? "Anonymous");
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
  const budgetedLongAnimationFrames = takeLatestEntriesWithinByteBudget(
    readBoundedEntries(longAnimationFrames),
  );
  const budgetedComponentEvents = takeLatestEntriesWithinByteBudget(
    readBoundedEntries(componentEvents),
  );
  const budgetedInteractions = takeLatestEntriesWithinByteBudget(readBoundedEntries(interactions));
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
    longAnimationFrames: budgetedLongAnimationFrames.entries,
    componentEvents: budgetedComponentEvents.entries,
    interactions: budgetedInteractions.entries,
    cumulativeLayoutShift,
    largestContentfulPaintMs,
    droppedLongAnimationFrames: longAnimationFrames.dropped + budgetedLongAnimationFrames.dropped,
    droppedScriptTimings,
    droppedComponentEvents: componentEvents.dropped + budgetedComponentEvents.dropped,
    droppedInteractions: interactions.dropped + budgetedInteractions.dropped,
  };
};

window.__REACT_DOCTOR_RUNTIME_SCAN__ = {
  snapshot,
};

const captureNavigationSnapshot = (): void => {
  if (window !== window.top || didCaptureCurrentPageState) return;
  didCaptureCurrentPageState = true;
  captureSnapshot(snapshot());
};

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    captureNavigationSnapshot();
  } else {
    didCaptureCurrentPageState = false;
  }
});
window.addEventListener("pageshow", () => {
  didCaptureCurrentPageState = false;
});
window.addEventListener("beforeunload", captureNavigationSnapshot);
window.addEventListener("pagehide", captureNavigationSnapshot);
