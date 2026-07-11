import { BYTES_PER_KIBIBYTE } from "./constants.ts";
import type { ProcessResourceUsage } from "./types.ts";

export const parseProcessResourceUsage = (stderr: string): ProcessResourceUsage => {
  const darwinTimingMatch = stderr.match(/([\d.]+)\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/);
  const darwinResidentSetMatch = stderr.match(/(\d+)\s+maximum resident set size/);
  const linuxUserMatch = stderr.match(/User time \(seconds\):\s*([\d.]+)/);
  const linuxSystemMatch = stderr.match(/System time \(seconds\):\s*([\d.]+)/);
  const linuxResidentSetMatch = stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
  const userSecondsText = darwinTimingMatch?.[2] ?? linuxUserMatch?.[1];
  const systemSecondsText = darwinTimingMatch?.[3] ?? linuxSystemMatch?.[1];
  let maximumResidentSetBytes: number | null = null;
  if (darwinResidentSetMatch) {
    maximumResidentSetBytes = Number(darwinResidentSetMatch[1]);
  } else if (linuxResidentSetMatch) {
    maximumResidentSetBytes = Number(linuxResidentSetMatch[1]) * BYTES_PER_KIBIBYTE;
  }
  return {
    userSeconds: userSecondsText === undefined ? null : Number(userSecondsText),
    systemSeconds: systemSecondsText === undefined ? null : Number(systemSecondsText),
    maximumResidentSetBytes,
  };
};
