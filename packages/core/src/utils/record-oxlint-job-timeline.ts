import * as fs from "node:fs";
import { OXLINT_JOB_TIMELINE_STDOUT_PREVIEW_BYTES } from "../constants.js";

export interface OxlintJobTimelineEntry {
  readonly pid: number | null;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutPreview: string;
}

// Performance-harness timeline hook (scripts/performance): one JSON line per
// oxlint job (legacy child or pooled worker job) plus the parent's CPU usage
// at exit. Off unless the env is set.
const TIMELINE_PATH = process.env.REACT_DOCTOR_OXLINT_SPAWN_LOG;

export const isOxlintJobTimelineEnabled = TIMELINE_PATH !== undefined;

const appendTimelineLine = (entry: Record<string, unknown>): void => {
  if (TIMELINE_PATH === undefined) return;
  fs.appendFileSync(TIMELINE_PATH, `${JSON.stringify(entry)}\n`);
};

if (TIMELINE_PATH !== undefined) {
  process.once("exit", () => {
    const cpuUsage = process.cpuUsage();
    appendTimelineLine({
      kind: "parent",
      pid: process.pid,
      exitedAt: Date.now(),
      userMicroseconds: cpuUsage.user,
      systemMicroseconds: cpuUsage.system,
    });
  });
}

const countOxlintFileArguments = (args: readonly string[]): number => {
  let fileCount = 0;
  for (let argumentIndex = 1; argumentIndex < args.length; argumentIndex += 1) {
    if (args[argumentIndex]?.startsWith("-")) {
      argumentIndex += 1;
      continue;
    }
    fileCount += 1;
  }
  return fileCount;
};

export const previewOxlintStdout = (stdout: string | Buffer): string =>
  Buffer.from(stdout).subarray(0, OXLINT_JOB_TIMELINE_STDOUT_PREVIEW_BYTES).toString("utf8");

export const recordOxlintJobTimeline = (entry: OxlintJobTimelineEntry): void => {
  if (TIMELINE_PATH === undefined) return;
  const configFlagIndex = entry.args.indexOf("-c");
  appendTimelineLine({
    kind: "child",
    pid: entry.pid,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    fileCount: countOxlintFileArguments(entry.args),
    configPath: configFlagIndex === -1 ? null : (entry.args[configFlagIndex + 1] ?? null),
    exitCode: entry.exitCode,
    signal: entry.signal,
    stdoutBytes: entry.stdoutBytes,
    stderrBytes: entry.stderrBytes,
    stdoutPreview: entry.stdoutPreview,
  });
};
