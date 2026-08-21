import {
  RUNTIME_SCAN_LAYOUT_THRASH_RATIO,
  RUNTIME_SCAN_MAX_HOTSPOTS,
  RUNTIME_SCAN_SCHEMA_VERSION,
} from "./constants.js";
import { sanitizeRuntimeUrl } from "./sanitize-runtime-url.js";
import type {
  RuntimeScanComponentHotspot,
  RuntimeScanInteraction,
  RuntimeScanProbeSnapshot,
  RuntimeScanReport,
  RuntimeScanScriptHotspot,
} from "./types.js";

export interface BuildRuntimeScanReportInput {
  readonly requestedUrl: string;
  readonly tracePath: string;
  readonly capturedAt: string;
  readonly durationMs: number;
  readonly snapshot: RuntimeScanProbeSnapshot;
  readonly connection: "isolated" | "cdp";
}

interface MutableScriptHotspot {
  sourceUrl: string;
  functionName: string;
  sourceCharPosition: number;
  invoker: string;
  totalDurationMs: number;
  maxDurationMs: number;
  forcedStyleAndLayoutDurationMs: number;
  frameCount: number;
}

interface MutableComponentHotspot {
  name: string;
  source: "native" | "bippy";
  renderCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

interface MutableRuntimeScanInteraction {
  name: string;
  startTime: number;
  durationMs: number;
  processingStart: number;
  processingEnd: number;
  interactionId: number;
  documentIndex?: number;
  targetTag: string | null;
}

const buildInteractions = (
  snapshot: RuntimeScanProbeSnapshot,
): ReadonlyArray<RuntimeScanInteraction> => {
  const interactionsById = new Map<string, MutableRuntimeScanInteraction>();
  for (const interaction of snapshot.interactions) {
    const key = `${interaction.documentIndex ?? 0}:${interaction.interactionId}`;
    const existing = interactionsById.get(key);
    if (existing === undefined) {
      interactionsById.set(key, { ...interaction });
      continue;
    }
    existing.name = interaction.name;
    existing.startTime = Math.min(existing.startTime, interaction.startTime);
    existing.durationMs = Math.max(existing.durationMs, interaction.durationMs);
    existing.processingStart = Math.min(existing.processingStart, interaction.processingStart);
    existing.processingEnd = Math.max(existing.processingEnd, interaction.processingEnd);
    existing.targetTag ??= interaction.targetTag;
  }
  return [...interactionsById.values()].sort((left, right) => left.startTime - right.startTime);
};

const buildScriptHotspots = (
  snapshot: RuntimeScanProbeSnapshot,
): ReadonlyArray<RuntimeScanScriptHotspot> => {
  const hotspots = new Map<string, MutableScriptHotspot>();
  for (const longAnimationFrame of snapshot.longAnimationFrames) {
    const hotspotKeysInFrame = new Set<string>();
    for (const script of longAnimationFrame.scripts) {
      const key = `${script.sourceUrl}\u0000${script.sourceFunctionName}\u0000${script.sourceCharPosition}\u0000${script.invoker}`;
      const existing = hotspots.get(key);
      if (existing === undefined) {
        hotspots.set(key, {
          sourceUrl: script.sourceUrl,
          functionName: script.sourceFunctionName || "(anonymous)",
          sourceCharPosition: script.sourceCharPosition,
          invoker: script.invoker,
          totalDurationMs: script.durationMs,
          maxDurationMs: script.durationMs,
          forcedStyleAndLayoutDurationMs: script.forcedStyleAndLayoutDurationMs,
          frameCount: 1,
        });
      } else {
        existing.totalDurationMs += script.durationMs;
        existing.maxDurationMs = Math.max(existing.maxDurationMs, script.durationMs);
        existing.forcedStyleAndLayoutDurationMs += script.forcedStyleAndLayoutDurationMs;
        if (!hotspotKeysInFrame.has(key)) existing.frameCount += 1;
      }
      hotspotKeysInFrame.add(key);
    }
  }
  return [...hotspots.values()]
    .sort((left, right) => right.totalDurationMs - left.totalDurationMs)
    .slice(0, RUNTIME_SCAN_MAX_HOTSPOTS);
};

const buildComponentHotspots = (
  snapshot: RuntimeScanProbeSnapshot,
): ReadonlyArray<RuntimeScanComponentHotspot> => {
  const hotspots = new Map<string, MutableComponentHotspot>();
  for (const componentEvent of snapshot.componentEvents) {
    const key = `${componentEvent.source}\u0000${componentEvent.name}`;
    const existing = hotspots.get(key);
    if (existing === undefined) {
      hotspots.set(key, {
        name: componentEvent.name,
        source: componentEvent.source,
        renderCount: 1,
        totalDurationMs: componentEvent.durationMs,
        maxDurationMs: componentEvent.durationMs,
      });
      continue;
    }
    existing.renderCount += 1;
    existing.totalDurationMs += componentEvent.durationMs;
    existing.maxDurationMs = Math.max(existing.maxDurationMs, componentEvent.durationMs);
  }
  return [...hotspots.values()]
    .sort((left, right) => right.totalDurationMs - left.totalDurationMs)
    .slice(0, RUNTIME_SCAN_MAX_HOTSPOTS);
};

const buildWarnings = (snapshot: RuntimeScanProbeSnapshot): ReadonlyArray<string> => {
  const warnings: string[] = [];
  if (!snapshot.support.reactDetected) {
    warnings.push("No React renderer was detected during the recording.");
  } else if (!snapshot.support.nativeReactTracks && !snapshot.support.bippyComponentTracks) {
    warnings.push(
      "React component timings were unavailable. Production builds require react-dom/profiling.",
    );
  }
  if (!snapshot.support.loaf) {
    warnings.push("Long Animation Frame entries are unavailable in this browser.");
  }
  if (
    snapshot.droppedLongAnimationFrames > 0 ||
    snapshot.droppedScriptTimings > 0 ||
    snapshot.droppedComponentEvents > 0 ||
    snapshot.droppedInteractions > 0
  ) {
    warnings.push(
      `The bounded probe dropped ${snapshot.droppedLongAnimationFrames} frames, ${snapshot.droppedScriptTimings} script timings, ${snapshot.droppedComponentEvents} component events, and ${snapshot.droppedInteractions} interactions.`,
    );
  }
  const layoutDominatedScript = snapshot.longAnimationFrames
    .flatMap((longAnimationFrame) => longAnimationFrame.scripts)
    .find(
      (script) =>
        script.durationMs > 0 &&
        script.forcedStyleAndLayoutDurationMs / script.durationMs >=
          RUNTIME_SCAN_LAYOUT_THRASH_RATIO,
    );
  if (layoutDominatedScript !== undefined) {
    warnings.push(
      "At least one long frame was substantially dominated by forced style and layout.",
    );
  }
  return warnings;
};

export const buildRuntimeScanReport = (input: BuildRuntimeScanReportInput): RuntimeScanReport => {
  const longAnimationFrames = [...input.snapshot.longAnimationFrames].sort(
    (left, right) => right.durationMs - left.durationMs,
  );
  const interactions = buildInteractions(input.snapshot);
  const interactionDurations = interactions.map((interaction) => interaction.durationMs);
  return {
    schemaVersion: RUNTIME_SCAN_SCHEMA_VERSION,
    kind: "react-doctor-runtime-scan",
    requestedUrl: sanitizeRuntimeUrl(input.requestedUrl),
    finalUrl: sanitizeRuntimeUrl(input.snapshot.finalUrl),
    tracePath: input.tracePath,
    capturedAt: input.capturedAt,
    timeOrigin: input.snapshot.timeOrigin,
    connection: input.connection,
    support: input.snapshot.support,
    summary: {
      durationMs: input.durationMs,
      longAnimationFrameCount: longAnimationFrames.length,
      worstFrameDurationMs: longAnimationFrames[0]?.durationMs ?? 0,
      totalBlockingDurationMs: longAnimationFrames.reduce(
        (total, longAnimationFrame) => total + longAnimationFrame.blockingDurationMs,
        0,
      ),
      interactionCount: interactions.length,
      worstInteractionDurationMs:
        interactionDurations.length === 0 ? 0 : Math.max(...interactionDurations),
      cumulativeLayoutShift: input.snapshot.cumulativeLayoutShift,
      largestContentfulPaintMs: input.snapshot.largestContentfulPaintMs,
    },
    scriptHotspots: buildScriptHotspots(input.snapshot),
    componentHotspots: buildComponentHotspots(input.snapshot),
    longAnimationFrames,
    interactions,
    warnings: buildWarnings(input.snapshot),
  };
};
