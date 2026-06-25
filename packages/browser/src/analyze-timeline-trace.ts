import type { TimelineAnalysis, TimelinePhaseStat } from "./types.js";
import { roundToHundredths } from "./utils/round.js";

// CDP types trace events loosely (string maps), so we narrow `name`/`dur`
// ourselves. Complete events (`ph: "X"`) carry a microsecond `dur`; the rest of
// the event shape is written to the trace file verbatim but ignored here.
interface TraceEvent {
  name?: unknown;
  dur?: unknown;
}

// Trace event names that represent a forced/scheduled reflow phase. `Layout` and
// `UpdateLayoutTree` (style recalc) are the cost of reading layout on a dirty
// page; `HitTest` is what `elementsFromPoint` triggers; `Paint` follows both.
const PHASE_BY_EVENT_NAME: Record<string, keyof TimelineAnalysis> = {
  UpdateLayoutTree: "styleRecalc",
  RecalculateStyles: "styleRecalc",
  Layout: "layout",
  HitTest: "hitTest",
  Paint: "paint",
};

const emptyPhase = (): TimelinePhaseStat => ({ totalMs: 0, count: 0, longestMs: 0 });

// Roll a Chrome DevTools timeline trace up into per-phase wall time, so the
// native style/layout/hit-test cost a forced reflow incurs is a number in the
// perf report rather than something you can only see in the trace file.
export const analyzeTimelineTrace = (events: TraceEvent[]): TimelineAnalysis => {
  const phases: TimelineAnalysis = {
    styleRecalc: emptyPhase(),
    layout: emptyPhase(),
    hitTest: emptyPhase(),
    paint: emptyPhase(),
  };
  for (const event of events) {
    if (typeof event.name !== "string" || typeof event.dur !== "number") continue;
    const phaseKey = PHASE_BY_EVENT_NAME[event.name];
    if (!phaseKey) continue;
    const durationMs = event.dur / 1000;
    const phase = phases[phaseKey];
    phase.totalMs += durationMs;
    phase.count += 1;
    if (durationMs > phase.longestMs) phase.longestMs = durationMs;
  }
  for (const phase of Object.values(phases)) {
    phase.totalMs = roundToHundredths(phase.totalMs);
    phase.longestMs = roundToHundredths(phase.longestMs);
  }
  return phases;
};
