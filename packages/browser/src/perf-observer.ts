import type { PageVitals } from "./types.js";

// Runs in the page (via evaluate) and resolves after `windowMs`. Installs fresh
// LoAF / LCP / CLS observers with `buffered: true`, so frames already in the
// performance timeline (a load just navigated to, or an interaction a previous
// command drove) are replayed immediately, while the window catches anything
// that fires next. A reload resets the timeline, so a fresh-load measurement
// always starts clean. For repeated no-reload measurements on the persistent
// page, `buffered: true` would otherwise replay — and re-count — every frame
// from earlier runs, inflating LoAF rows and CLS. So we keep a per-page
// watermark of the latest entry `startTime` already counted (per type) and skip
// anything at or below it: the first run after an interaction still captures its
// frames, a second run sees only what fired since. LoAF fields are not in
// lib.dom, so the casts here are unavoidable.
export const collectPerformanceReport = (windowMs: number): Promise<PageVitals> => {
  interface ScriptTiming {
    sourceURL?: string;
    sourceFunctionName?: string;
    invokerType?: string;
    duration?: number;
    forcedStyleAndLayoutDuration?: number;
  }
  interface LongAnimationFrameEntry {
    startTime: number;
    duration: number;
    blockingDuration?: number;
    scripts?: ScriptTiming[];
  }
  interface LayoutShiftEntry {
    value: number;
    hadRecentInput: boolean;
  }
  interface MutableReport {
    longAnimationFrames: PageVitals["longAnimationFrames"];
    largestContentfulPaintMs: number | null;
    cumulativeLayoutShift: number;
  }

  interface CountedEntryWatermark {
    longAnimationFrame: number;
    layoutShift: number;
  }
  const WATERMARK_KEY = "__REACT_DOCTOR_PERF_WATERMARK__";

  return new Promise<PageVitals>((resolve) => {
    const report: MutableReport = {
      longAnimationFrames: [],
      largestContentfulPaintMs: null,
      cumulativeLayoutShift: 0,
    };

    // Persisted on the page so it survives across no-reload measurements (and is
    // wiped by a navigation, which is exactly when we want a clean slate).
    const windowScope = window as unknown as Record<string, CountedEntryWatermark | undefined>;
    const previousWatermark: CountedEntryWatermark = windowScope[WATERMARK_KEY] ?? {
      longAnimationFrame: -1,
      layoutShift: -1,
    };
    const nextWatermark: CountedEntryWatermark = { ...previousWatermark };

    const observers: PerformanceObserver[] = [];
    const observe = (type: string, onEntry: (entry: PerformanceEntry) => void): void => {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) onEntry(entry);
        });
        observer.observe({ type, buffered: true });
        observers.push(observer);
      } catch {}
    };

    observe("long-animation-frame", (entry) => {
      if (entry.startTime <= previousWatermark.longAnimationFrame) return;
      nextWatermark.longAnimationFrame = Math.max(
        nextWatermark.longAnimationFrame,
        entry.startTime,
      );
      const longAnimationFrame = entry as unknown as LongAnimationFrameEntry;
      report.longAnimationFrames.push({
        startTimeMs: Math.round(longAnimationFrame.startTime),
        durationMs: Math.round(longAnimationFrame.duration),
        blockingDurationMs: Math.round(longAnimationFrame.blockingDuration ?? 0),
        scripts: (longAnimationFrame.scripts ?? []).map((scriptTiming) => ({
          sourceUrl: scriptTiming.sourceURL ?? "",
          sourceFunctionName: scriptTiming.sourceFunctionName ?? "",
          invokerType: scriptTiming.invokerType ?? "",
          durationMs: Math.round(scriptTiming.duration ?? 0),
          forcedStyleAndLayoutMs: Math.round(scriptTiming.forcedStyleAndLayoutDuration ?? 0),
        })),
      });
    });

    observe("largest-contentful-paint", (entry) => {
      report.largestContentfulPaintMs = Math.round(entry.startTime);
    });

    observe("layout-shift", (entry) => {
      if (entry.startTime <= previousWatermark.layoutShift) return;
      nextWatermark.layoutShift = Math.max(nextWatermark.layoutShift, entry.startTime);
      const layoutShift = entry as unknown as LayoutShiftEntry;
      if (!layoutShift.hadRecentInput) report.cumulativeLayoutShift += layoutShift.value;
    });

    setTimeout(() => {
      for (const observer of observers) observer.disconnect();
      windowScope[WATERMARK_KEY] = nextWatermark;
      resolve({
        longAnimationFrames: report.longAnimationFrames.sort(
          (left, right) => right.durationMs - left.durationMs,
        ),
        largestContentfulPaintMs: report.largestContentfulPaintMs,
        cumulativeLayoutShift: Math.round(report.cumulativeLayoutShift * 1000) / 1000,
      });
    }, windowMs);
  });
};
