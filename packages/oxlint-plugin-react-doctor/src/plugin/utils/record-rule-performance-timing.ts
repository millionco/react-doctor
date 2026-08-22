import * as fs from "node:fs";
import * as path from "node:path";

interface MutableRulePerformanceTiming {
  rule: string;
  selector: string;
  timeNanoseconds: bigint;
  calls: number;
}

const RULE_TIMING_DIRECTORY = process.env.REACT_DOCTOR_RULE_TIMINGS_DIR;
const timingsByKey = new Map<string, MutableRulePerformanceTiming>();

if (RULE_TIMING_DIRECTORY !== undefined) {
  process.once("exit", () => {
    fs.mkdirSync(RULE_TIMING_DIRECTORY, { recursive: true });
    fs.writeFileSync(
      path.join(RULE_TIMING_DIRECTORY, `react-doctor-${process.pid}.rule-timings.json`),
      JSON.stringify(
        [...timingsByKey.values()].map((timing) => ({
          ...timing,
          timeNanoseconds: timing.timeNanoseconds.toString(),
        })),
      ),
    );
  });
}

export const isRulePerformanceTimingEnabled = RULE_TIMING_DIRECTORY !== undefined;

export const recordRulePerformanceTiming = (
  rule: string,
  selector: string,
  elapsedNanoseconds: bigint,
): void => {
  const key = `${rule}\0${selector}`;
  const timing = timingsByKey.get(key) ?? {
    rule,
    selector,
    timeNanoseconds: 0n,
    calls: 0,
  };
  timing.timeNanoseconds += elapsedNanoseconds;
  timing.calls += 1;
  timingsByKey.set(key, timing);
};
