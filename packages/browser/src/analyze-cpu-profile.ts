import { MAX_PROFILE_FUNCTIONS } from "./constants.js";
import type { CpuProfileAnalysis } from "./types.js";
import { roundToHundredths } from "./utils/round.js";

interface CpuProfileCallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
}

interface CpuProfileNode {
  id: number;
  callFrame: CpuProfileCallFrame;
  hitCount?: number;
}

// The shape of `Profiler.stop`'s `profile` (a structural subset of CDP's
// Protocol.Profiler.Profile), the same JSON DevTools writes to a `.cpuprofile`.
export interface CdpCpuProfile {
  nodes: CpuProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

// A function's display key: V8's synthetic frames ("(idle)", "(program)",
// "(garbage collector)", "(root)") have no url and are kept as-is so the
// percentages still add up to the wall time the profile covered.
const labelFor = (callFrame: CpuProfileCallFrame): { name: string; url: string | null } => {
  const name = callFrame.functionName || "(anonymous)";
  const url = callFrame.url ? `${callFrame.url}:${callFrame.lineNumber + 1}` : null;
  return { name, url };
};

// Fold a CDP CPU profile into self-time-per-function: each sample attributes its
// paired time delta to the function on top of the stack at that sample. This
// approximates the self-time DevTools' bottom-up view shows — where JS wall time
// went (attribution can shift by up to one sample interval) — without the raw
// node tree. Totals still sum to the wall time the profile covered.
export const analyzeCpuProfile = (profile: CdpCpuProfile): CpuProfileAnalysis => {
  const durationMs = (profile.endTime - profile.startTime) / 1000;
  const samples = profile.samples ?? [];
  const timeDeltas = profile.timeDeltas ?? [];

  const nodeById = new Map<number, CpuProfileNode>();
  for (const node of profile.nodes) nodeById.set(node.id, node);

  // Accumulate self time (microseconds) by function key, summing same-named
  // frames so a function split across optimization tiers reads as one row.
  interface SelfTimeAccumulator {
    functionName: string;
    url: string | null;
    selfUs: number;
  }
  const accumulatorByKey = new Map<string, SelfTimeAccumulator>();
  const addSelfTime = (node: CpuProfileNode | undefined, microseconds: number): void => {
    if (!node) return;
    const { name, url } = labelFor(node.callFrame);
    const key = `${name}@${url ?? ""}`;
    const existing = accumulatorByKey.get(key);
    if (existing) {
      existing.selfUs += microseconds;
      return;
    }
    accumulatorByKey.set(key, { functionName: name, url, selfUs: microseconds });
  };

  if (samples.length > 0 && timeDeltas.length === samples.length) {
    for (let index = 0; index < samples.length; index += 1) {
      addSelfTime(nodeById.get(samples[index]), timeDeltas[index]);
    }
  } else {
    // No sample stream (rare): fall back to hitCount, scaling the node's share of
    // total hits across the measured duration.
    const totalHits = profile.nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0) || 1;
    const durationUs = durationMs * 1000;
    for (const node of profile.nodes) {
      addSelfTime(node, ((node.hitCount ?? 0) / totalHits) * durationUs);
    }
  }

  const topFunctions = [...accumulatorByKey.values()]
    .map((accumulator) => {
      const selfMs = accumulator.selfUs / 1000;
      return {
        functionName: accumulator.functionName,
        url: accumulator.url,
        selfMs: roundToHundredths(selfMs),
        selfPercent: durationMs > 0 ? roundToHundredths((selfMs / durationMs) * 100) : 0,
      };
    })
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, MAX_PROFILE_FUNCTIONS);

  return { durationMs: roundToHundredths(durationMs), sampleCount: samples.length, topFunctions };
};
