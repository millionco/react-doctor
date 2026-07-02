import type { ReactDoctorConfig } from "@react-doctor/core";

// A scanned project as the aggregate share gate sees it: only its merged
// (root + module) config matters.
interface ShareGateScan {
  readonly config: ReactDoctorConfig | null;
}

// The multi-project summary shows ONE share link for the whole run, so ANY
// scanned project opting out suppresses it for all of them: a flag-level
// `--no-score` / `--no-telemetry` (undefined when unset), or a project's merged
// `noScore` / explicit `share: false`. A project with neither stays opted in.
export const isShareOptedOut = (
  scans: readonly ShareGateScan[],
  flagNoScore: boolean | undefined,
): boolean =>
  Boolean(flagNoScore) ||
  scans.some((scan) => Boolean(scan.config?.noScore) || scan.config?.share === false);
