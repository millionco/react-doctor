import type { PageVitals } from "./types.js";

// Runs in the page (via evaluate) and resolves after `windowMs`. Installs fresh
// LoAF / LCP / CLS observers with `buffered: true`, so frames already in the
// timeline when the observer attaches (an interaction the caller drove just
// before measuring) are replayed immediately, while the window catches anything
// that fires next. The recording-start floor is read in-page from `markerKey`
// (the `performance.now()` the caller stashed when the recorders armed): every
// entry at or below it is skipped, so the report only counts this window's
// frames — never initial page-load jank still in the buffer, never frames an
// earlier no-reload run already reported. A navigation during the driven action
// wipes the marker with the old document, so the new document reads 0 and keeps
// its full load vitals — the navigation is itself the measured event. LoAF
// fields are not in lib.dom, so the casts here are unavoidable.
export const collectPerformanceReport = (options: {
  windowMs: number;
  markerKey: string;
}): Promise<PageVitals> => {
  const { windowMs, markerKey } = options;
  const markerValue = Reflect.get(globalThis, markerKey);
  const sinceMs = typeof markerValue === "number" ? markerValue : 0;
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

  return new Promise<PageVitals>((resolve) => {
    const report: MutableReport = {
      longAnimationFrames: [],
      largestContentfulPaintMs: null,
      cumulativeLayoutShift: 0,
    };

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
      if (entry.startTime <= sinceMs) return;
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
      if (entry.startTime <= sinceMs) return;
      report.largestContentfulPaintMs = Math.round(entry.startTime);
    });

    observe("layout-shift", (entry) => {
      if (entry.startTime <= sinceMs) return;
      const layoutShift = entry as unknown as LayoutShiftEntry;
      if (!layoutShift.hadRecentInput) report.cumulativeLayoutShift += layoutShift.value;
    });

    setTimeout(() => {
      for (const observer of observers) observer.disconnect();
      resolve({
        // Blocking duration — not total duration — is the jank signal: a long
        // frame that blocks nothing (an idle/backgrounded render, the first
        // frame after navigation) isn't main-thread jank, and ranking by total
        // duration buries the frames that actually stalled input behind those
        // artifacts. Drop the non-blocking frames and rank by what blocked.
        longAnimationFrames: report.longAnimationFrames
          .filter((frame) => frame.blockingDurationMs > 0)
          .sort((left, right) => right.blockingDurationMs - left.blockingDurationMs),
        largestContentfulPaintMs: report.largestContentfulPaintMs,
        cumulativeLayoutShift: Math.round(report.cumulativeLayoutShift * 1000) / 1000,
      });
    }, windowMs);
  });
};
