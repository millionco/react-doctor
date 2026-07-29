import {
  DEAD_CODE_OVERLAP_PARSE_SHARE,
  MIN_DEAD_CODE_PARSE_CONCURRENCY,
  MIN_SCAN_CONCURRENCY,
} from "./constants.js";
import type { ReactDoctorConfig } from "./types/index.js";
import { deadCodeMaySurfaceWhenWarningsHidden } from "./utils/dead-code-may-surface.js";

export interface BuildDeadCodePlanInput {
  readonly runDeadCode: boolean;
  readonly isDiffMode: boolean;
  readonly showWarnings: boolean;
  readonly userConfig: ReactDoctorConfig | null;
  readonly overlapMode: "auto" | "on" | "off";
  readonly scanConcurrency: number;
}

export interface DeadCodePlan {
  readonly shouldRun: boolean;
  readonly shouldOverlap: boolean;
  readonly parseConcurrency: number | undefined;
  readonly lintConcurrency: number;
}

export const buildDeadCodePlan = (input: BuildDeadCodePlanInput): DeadCodePlan => {
  const shouldRun =
    input.runDeadCode &&
    !input.isDiffMode &&
    (input.showWarnings || deadCodeMaySurfaceWhenWarningsHidden(input.userConfig));
  const shouldOverlap = shouldRun && input.overlapMode === "on";
  const parseConcurrency = shouldOverlap
    ? Math.max(
        MIN_DEAD_CODE_PARSE_CONCURRENCY,
        Math.floor(input.scanConcurrency * DEAD_CODE_OVERLAP_PARSE_SHARE),
      )
    : undefined;

  return {
    shouldRun,
    shouldOverlap,
    parseConcurrency,
    lintConcurrency:
      parseConcurrency === undefined
        ? input.scanConcurrency
        : Math.max(MIN_SCAN_CONCURRENCY, input.scanConcurrency - parseConcurrency),
  };
};
