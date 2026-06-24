import type { PageVitals } from "./types.js";

// Runs in the page (via evaluate) and resolves after `windowMs`. Installs fresh
// LoAF / LCP / CLS observers with `buffered: true`, so frames already in the
// timeline when the observer attaches (an interaction the caller drove just
// before measuring) are replayed immediately, while the window catches anything
// that fires next. `sinceMs` is the recording-start `performance.now()` the
// caller captured right before the driven action: every entry at or below it is
// skipped, so the report only counts frames from this window — never initial
// page-load jank still sitting in the buffer, and never frames an earlier
// no-reload run on the persistent page already reported. LoAF fields are not in
// lib.dom, so the casts here are unavoidable.
export const collectPerformanceReport = (options: {
  windowMs: number;
  sinceMs: number;
}): Promise<PageVitals> => {
  const { windowMs, sinceMs } = options;
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
